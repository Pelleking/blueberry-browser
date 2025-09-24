import { createServer, Server as HttpServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import type { Window } from "./Window";
import type { Tab } from "./Tab";
import { PageInspector } from "./page/PageInspector";
import type { PageInfo } from "./common/types";
import type { LLMClient } from "./LLMClient";

export interface BridgeChatEmitter {
	emitChat: (payload: { role: "browser" | "assistant" | "user"; text: string }) => void;
	emitEvent: (payload: { name: string; data: unknown }) => void;
}

interface BridgeCommand {
	v?: number;
	type: "cmd";
	id: string;
	name: string;
	args?: Record<string, unknown>;
}

interface BridgeResponse {
	v: number;
	type: "res";
	id: string;
	ok: boolean;
	data?: unknown;
	error?: string;
}

// Removed local PageInfo. Use shared type from ../common/types where needed.

export class BridgeServer implements BridgeChatEmitter {
	private httpServer: HttpServer | null = null;
	private wsServer: WebSocketServer | null = null;
	private clients: Set<WebSocket> = new Set();
	private heartbeatTimer: NodeJS.Timeout | null = null;
	private connectionAlive: WeakMap<WebSocket, boolean> = new WeakMap();
	private window: Window;
	private llm: LLMClient;
	private inspector: PageInspector;

	constructor(window: Window, llm: LLMClient) {
		this.window = window;
		this.llm = llm;
		this.inspector = new PageInspector(window);
	}

	public start(): void {
		if (this.httpServer) return;
		const port = Number(process.env.BRIDGE_PORT || 4939);
		this.httpServer = createServer();
		this.wsServer = new WebSocketServer({ server: this.httpServer, path: "/bridge" });

		this.wsServer.on("connection", (ws, req) => {
			if (!this.authOk(req, ws)) return;
			this.clients.add(ws);
			// Mark connection alive and listen for pong
			this.connectionAlive.set(ws, true);
			ws.on("pong", () => this.connectionAlive.set(ws, true));
			// Remove any prior QR messages when a client connects
			try { this.llm.removeQrMessages(); } catch {}
			// Notify renderer of bridge connection
			this.notifyRendererConnected(true);
			// Send current active tab immediately
			try {
				const active = this.window.activeTab;
				if (active) this.broadcastActiveTab(active.url, active.id);
			} catch {}
			ws.on("message", (raw) => this.onMessage(ws, raw));
			ws.on("close", () => {
				this.clients.delete(ws);
				if (this.clients.size === 0) this.notifyRendererConnected(false);
			});
		});

		this.httpServer.listen(port, () => {
			const addr = (this.httpServer as HttpServer).address();
			// eslint-disable-next-line no-console
			console.log("Blueberry bridge on", typeof addr === "object" && addr ? addr.port : port);
		});

		// Heartbeat ping for Cloudflare/edge keepalive
		const pingSec = Number(process.env.BRIDGE_PING_SEC || 30);
		if (pingSec > 0) {
			this.heartbeatTimer = setInterval(() => {
				for (const ws of this.clients) {
					const alive = this.connectionAlive.get(ws);
					if (alive === false) {
						try { ws.terminate(); } catch { /* ignore */ }
						this.clients.delete(ws);
						continue;
					}
					this.connectionAlive.set(ws, false);
					try { ws.ping(); } catch { /* ignore */ }
				}
			}, Math.max(10, pingSec) * 1000);
		}
	}

	public stop(): void {
		try {
			this.wsServer?.close();
			this.httpServer?.close();
		} finally {
			if (this.heartbeatTimer) {
				clearInterval(this.heartbeatTimer);
				this.heartbeatTimer = null;
			}
			this.wsServer = null;
			this.httpServer = null;
			this.clients.clear();
		}
	}

	private authOk(req: any, ws: WebSocket): boolean {
		try {
			const proto: string | undefined = req.headers?.["sec-websocket-protocol"];
			const parts = (proto || "").split(",").map((s) => s.trim());
			const token = parts[2];
			const secret = process.env.BRIDGE_JWT_SECRET || "dev-secret";
			jwt.verify(String(token || ""), secret);
			return true;
		} catch {
			try { ws.close(4001, "unauthorized"); } catch {}
			return false;
		}
	}

	private onMessage(ws: WebSocket, raw: WebSocket.RawData): void {
		try {
			const msg: BridgeCommand = JSON.parse(String(raw));
			if (msg?.type === "cmd") {
				void this.handleCmd(msg, ws);
			}
		} catch {
			// ignore
		}
	}

	private send(ws: WebSocket, payload: BridgeResponse): void {
		try { ws.send(JSON.stringify(payload)); } catch {}
	}

	private emitAll(obj: unknown): void {
		const s = JSON.stringify(obj);
		for (const c of this.clients) if (c.readyState === WebSocket.OPEN) { try { c.send(s); } catch {} }
	}

	public emitChat({ role, text }: { role: "browser" | "assistant" | "user"; text: string }): void {
		this.emitAll({ v: 1, type: "chat", id: `m-${Date.now()}`, role, text, ts: Date.now() });
	}

	public emitEvent({ name, data }: { name: string; data: unknown }): void {
		this.emitAll({ v: 1, type: "evt", name, data, ts: Date.now() });
	}

	private broadcastActiveTab(url: string, tabId: string): void {
		this.emitEvent({ name: "activeTab", data: { tabId, url } });
	}

	private notifyRendererConnected(connected: boolean): void {
		try {
			this.window.topBar.view.webContents.send("bridge-connected", connected);
			this.window.sidebar.view.webContents.send("bridge-connected", connected);
		} catch {}
	}

  // Note: URL navigation is handled exclusively by LLM tools now

	private async getPageInfo(tabId?: string): Promise<{ title: string | null; url: string | null; status: number; contentSummary: string; links: Array<{ text: string; href: string }> }> {
		const tab: Tab | null = tabId ? this.window.getTab(tabId) : this.window.activeTab;
		if (!tab) throw new Error("No tab");
		const info: PageInfo = await this.inspector.getInfoForTab(tab);
		return { title: info.title, url: info.url, status: 200, contentSummary: info.summary, links: info.links };
	}

	private async handleCmd(msg: BridgeCommand, ws: WebSocket): Promise<void> {
		try {
				switch (msg.name) {
				case "getPageInfo": {
					const data = await this.getPageInfo(String((msg.args as any)?.tabId || ""));
					this.send(ws, { v: 1, type: "res", id: msg.id, ok: true, data });
					this.emitChat({ role: "browser", text: `${data.title ?? "(untitled)"} — ${data.contentSummary.slice(0, 140)}…` });
					break;
				}
				case "setFeature": {
					const key = String((msg.args as any)?.key || "");
					if (key === "offlineMode") {
						const value = Boolean((msg.args as any)?.value);
						await this.llm.setOfflineMode(value);
						this.emitEvent({ name: "featureState", data: { offlineMode: value } });
					}
					this.send(ws, { v: 1, type: "res", id: msg.id, ok: true, data: {} });
					break;
				}
				case "sendChat": {
					const text = String((msg.args as any)?.text || "");
					const messageId = `ws-${Date.now()}`;
					// Echo user chat to bridge immediately
					this.emitChat({ role: "user", text });
					await this.llm.sendChatMessage({ message: text, messageId });
					this.send(ws, { v: 1, type: "res", id: msg.id, ok: true, data: {} });
					break;
				}
				default:
					this.send(ws, { v: 1, type: "res", id: msg.id, ok: false, error: "Unknown command" });
			}
		} catch (e: any) {
			this.send(ws, { v: 1, type: "res", id: msg.id, ok: false, error: String(e?.message || e || "error") });
		}
	}
}
