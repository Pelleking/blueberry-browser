import type { CoreMessage } from "ai";
import type { WebContents } from "electron";
import type { BridgeChatEmitter } from "../BridgeServer";

export class MessageStore {
  private messages: CoreMessage[] = [];
  private web: WebContents;
  private bridge?: BridgeChatEmitter;
  private streamingIndex: number | null = null;

  constructor(webContents: WebContents, bridge?: BridgeChatEmitter) {
    this.web = webContents;
    this.bridge = bridge;
  }

  getAll(): CoreMessage[] {
    return this.messages;
  }

  setAll(messages: CoreMessage[]): void {
    this.messages = messages;
    this.emitToRenderer();
  }

  setBridge(bridge?: BridgeChatEmitter): void {
    this.bridge = bridge;
  }

  clear(): void {
    this.messages = [];
    this.emitToRenderer();
  }

  addAssistant(content: string): void {
    this.messages.push({ role: "assistant", content });
    this.emitToRenderer();
  }

  addUser(content: CoreMessage["content"]): void {
    this.messages.push({ role: "user", content });
    this.emitToRenderer();
  }

  beginStream(firstChunk: string): void {
    this.streamingIndex = this.messages.length;
    this.messages.push({ role: "assistant", content: firstChunk });
    this.emitToRenderer();
    this.bridgeSafeChat(firstChunk);
  }

  appendStream(chunk: string): void {
    if (this.streamingIndex === null) {
      this.beginStream(chunk);
      return;
    }
    const prev = String(this.messages[this.streamingIndex].content || "");
    const next = prev + chunk;
    this.messages[this.streamingIndex] = { role: "assistant", content: next };
    this.emitToRenderer();
    this.bridgeSafeChat(chunk);
  }

  endStream(): void {
    this.streamingIndex = null;
    this.emitToRenderer();
  }

  private emitToRenderer(): void {
    this.web.send("chat-messages-updated", this.messages);
  }

  private bridgeSafeChat(text: string): void {
    try { this.bridge?.emitChat({ role: "assistant", text }); } catch { /* ignore */ }
  }
}


