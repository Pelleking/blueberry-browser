import { ipcMain, WebContents } from "electron";
import os from "os";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import type { Window } from "./Window";
import { registerTabsEvents } from "./events/TabsEvents";
import { registerSidebarEvents } from "./events/SidebarEvents";
import { registerPageContentEvents } from "./events/PageContentEvents";
import { registerLLMEvents } from "./events/LLMEvents";
import { registerSystemEvents } from "./events/SystemEvents";

export class EventManager {
  private mainWindow: Window;
  private networkInterval: NodeJS.Timeout | null = null;
  private lastOnline: boolean | null = null;

  constructor(mainWindow: Window) {
    this.mainWindow = mainWindow;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    registerTabsEvents(this.mainWindow);
    registerSidebarEvents(this.mainWindow);
    registerPageContentEvents(this.mainWindow);
    registerLLMEvents(this.mainWindow);
    registerSystemEvents(this.mainWindow);
  }

  private handleTabEvents(): void {
    // Create new tab
    ipcMain.handle("create-tab", (_, url?: string) => {
      const newTab = this.mainWindow.createTab(url);
      return { id: newTab.id, title: newTab.title, url: newTab.url };
    });

    // Close tab
    ipcMain.handle("close-tab", (_, id: string) => {
      this.mainWindow.closeTab(id);
    });

    // Switch tab
    ipcMain.handle("switch-tab", (_, id: string) => {
      this.mainWindow.switchActiveTab(id);
    });

    // Get tabs
    ipcMain.handle("get-tabs", () => {
      const activeTabId = this.mainWindow.activeTab?.id;
      return this.mainWindow.allTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        isActive: activeTabId === tab.id,
      }));
    });

    // Navigation (for compatibility with existing code)
    ipcMain.handle("navigate-to", (_, url: string) => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.loadURL(url);
      }
    });

    ipcMain.handle("navigate-tab", async (_, tabId: string, url: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        await tab.loadURL(url);
        return true;
      }
      return false;
    });

    ipcMain.handle("go-back", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goBack();
      }
    });

    ipcMain.handle("go-forward", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goForward();
      }
    });

    ipcMain.handle("reload", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.reload();
      }
    });

    // Tab-specific navigation handlers
    ipcMain.handle("tab-go-back", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goBack();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-go-forward", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goForward();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-reload", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.reload();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-screenshot", async (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        const image = await tab.screenshot();
        return image.toDataURL();
      }
      return null;
    });

    ipcMain.handle("tab-run-js", async (_, tabId: string, code: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        return await tab.runJs(code);
      }
      return null;
    });

    // Tab info
    ipcMain.handle("get-active-tab-info", () => {
      const activeTab = this.mainWindow.activeTab;
      if (activeTab) {
        return {
          id: activeTab.id,
          url: activeTab.url,
          title: activeTab.title,
          canGoBack: activeTab.webContents.canGoBack(),
          canGoForward: activeTab.webContents.canGoForward(),
        };
      }
      return null;
    });
  }

  private handleSidebarEvents(): void {
    // Toggle sidebar
    ipcMain.handle("toggle-sidebar", () => {
      this.mainWindow.sidebar.toggle();
      this.mainWindow.updateAllBounds();
      return true;
    });

    // Chat message
    ipcMain.handle("sidebar-chat-message", async (_, request) => {
      // The LLMClient now handles getting the screenshot and context directly
      await this.mainWindow.sidebar.client.sendChatMessage(request);
    });

    // Clear chat
    ipcMain.handle("sidebar-clear-chat", () => {
      this.mainWindow.sidebar.client.clearMessages();
      return true;
    });

    // Get messages
    ipcMain.handle("sidebar-get-messages", () => {
      return this.mainWindow.sidebar.client.getMessages();
    });

    // Tool: open URL and summarize
    ipcMain.handle("open-url-and-summarize", async (_evt, url: string) => {
      await this.mainWindow.sidebar.client.openUrlAndSummarize(url);
      return true;
    });
  }

  private handlePageContentEvents(): void {
    // Get page content
    ipcMain.handle("get-page-content", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabHtml();
        } catch (error) {
          console.error("Error getting page content:", error);
          return null;
        }
      }
      return null;
    });

    // Get page text
    ipcMain.handle("get-page-text", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabText();
        } catch (error) {
          console.error("Error getting page text:", error);
          return null;
        }
      }
      return null;
    });

    // Get current URL
    ipcMain.handle("get-current-url", () => {
      if (this.mainWindow.activeTab) {
        return this.mainWindow.activeTab.url;
      }
      return null;
    });
  }

  private handleDarkModeEvents(): void {
    // Dark mode broadcasting
    ipcMain.on("dark-mode-changed", (event, isDarkMode) => {
      this.broadcastDarkMode(event.sender, isDarkMode);
    });
  }

  private handleLLMEvents(): void {
    // Get current offline mode
    ipcMain.handle("get-offline-mode", () => {
      return this.mainWindow.sidebar.client.getOfflineMode();
    });

    // Toggle/set offline mode
    ipcMain.handle("set-offline-mode", async (_evt, enabled: boolean) => {
      const result = await this.mainWindow.sidebar.client.setOfflineMode(enabled);
      if (enabled && !result) {
        // Post a friendly assistant message into the chat
        const reason = this.mainWindow.sidebar.client.getAppleUnavailableReason();
        const suffix = reason ? ` (Reason: ${reason})` : "";
        this.mainWindow.sidebar.client.addAssistantMessage(
          `OOh I see what you are trying to do here Pelle but your mac is not up to spec for that hehe${suffix}`
        );
      }
      this.broadcastOfflineMode(this.mainWindow.sidebar.client.getOfflineMode());
      return result;
    });

    // Generate QR for mobile bridge connection
    ipcMain.handle("generate-bridge-qr", async () => {
      try {
        const publicUrl = process.env.BRIDGE_PUBLIC_URL;
        const port = Number(process.env.BRIDGE_PORT || 4939);
        const ip = this.getLocalIpAddress();
        const url = publicUrl && publicUrl.trim() ? `${publicUrl.replace(/\/$/, "")}/bridge` : `ws://${ip}:${port}/bridge`;
        const secret = process.env.BRIDGE_JWT_SECRET || "dev-secret";
        const now = Math.floor(Date.now() / 1000);
        const ttlSec = Number(process.env.BRIDGE_TOKEN_TTL_SEC || 300);
        const token = jwt.sign(
          { sub: "blueberry-mobile", iat: now, nbf: now, exp: now + (ttlSec > 0 ? ttlSec : 300) },
          secret
        );
        const proto = `blueberry,v1,${token}`;
        const payload = { url, proto };
        const text = JSON.stringify(payload);
        const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: "M", scale: 6 });
        // Post a short instruction and the QR image
        this.mainWindow.sidebar.client.addAssistantMessage(
          [
            "Scan this QR code with the Blueberry mobile app (expires in 5 minutes):",
            "",
            `![](${dataUrl})`,
          ].join("\n")
        );
        return { ok: true };
      } catch (e) {
        console.error("Failed to generate QR:", e);
        return { ok: false };
      }
    });
  }

  private handleDebugEvents(): void {
    // Ping test
    ipcMain.on("ping", () => console.log("pong"));
  }

  private getLocalIpAddress(): string {
    try {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        const list = ifaces[name] || [];
        for (const iface of list) {
          if (!iface || iface.internal) continue;
          if (iface.family === "IPv4" && iface.address) return iface.address;
        }
      }
    } catch {
      // ignore
    }
    return "127.0.0.1";
  }

  private broadcastOfflineMode(enabled: boolean): void {
    // Notify topbar to update its icon state
    this.mainWindow.topBar.view.webContents.send("offline-mode-updated", enabled);
  }

  private async isOnline(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dns = require("dns");
        let settled = false;
        const done = (result: boolean): void => {
          if (!settled) {
            settled = true;
            resolve(result);
          }
        };
        const timer = setTimeout(() => done(false), 2000);
        dns.resolve("example.com", (err: unknown) => {
          clearTimeout(timer);
          if (err) return done(false);
          done(true);
        });
      } catch {
        resolve(false);
      }
    });
  }

  private startNetworkMonitoring(): void {
    if (this.networkInterval) return;
    const check = async (): Promise<void> => {
      const online = await this.isOnline();
      if (this.lastOnline === null) {
        this.lastOnline = online;
        return;
      }
      if (!online && this.lastOnline !== false) {
        // Went offline
        const alreadyOffline = this.mainWindow.sidebar.client.getOfflineMode();
        if (!alreadyOffline) {
          const enabled = await this.mainWindow.sidebar.client.setOfflineMode(true);
          this.broadcastOfflineMode(enabled);
        }
      }
      this.lastOnline = online;
    };
    // Initial delay then poll
    this.networkInterval = setInterval(check, 5000);
    // Run first check immediately
    void check();
  }

  private broadcastDarkMode(sender: WebContents, isDarkMode: boolean): void {
    // Send to topbar
    if (this.mainWindow.topBar.view.webContents !== sender) {
      this.mainWindow.topBar.view.webContents.send(
        "dark-mode-updated",
        isDarkMode
      );
    }

    // Send to sidebar
    if (this.mainWindow.sidebar.view.webContents !== sender) {
      this.mainWindow.sidebar.view.webContents.send(
        "dark-mode-updated",
        isDarkMode
      );
    }

    // Send to all tabs
    this.mainWindow.allTabs.forEach((tab) => {
      if (tab.webContents !== sender) {
        tab.webContents.send("dark-mode-updated", isDarkMode);
      }
    });
  }

  // Clean up event listeners
  public cleanup(): void {
    ipcMain.removeAllListeners();
    if (this.networkInterval) {
      clearInterval(this.networkInterval);
      this.networkInterval = null;
    }
  }
}
