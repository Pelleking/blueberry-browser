import type { CoreMessage } from "ai";

export class Logger {
  constructor(private debug: boolean) {}

  shouldLog(): boolean {
    return this.debug;
  }

  logOutgoing(provider: string, model: string, messages: CoreMessage[]): void {
    if (!this.debug) return;
    const includesScreenshot = messages.some((m) => Array.isArray(m.content) && (m.content as any[]).some((p) => (p as any)?.type === "image"));
    const summary = messages.map((m) => ({ role: m.role, content: this.sanitize(m.content) }));
    console.log(`[LLM:${provider}] model=${model} screenshot=${includesScreenshot}`);
    console.log("[LLM] Outgoing request (redacted):", JSON.stringify(summary, null, 2));
  }

  truncate(text: string, max = 500): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + ` ...[+${text.length - max} chars]`;
  }

  private sanitize(content: CoreMessage["content"]): unknown {
    if (typeof content === "string") return this.truncate(content);
    if (Array.isArray(content)) {
      return (content as any[]).map((p) => {
        if ((p as any)?.type === "text") return { type: "text", text: this.truncate(String((p as any)?.text || "")) };
        if ((p as any)?.type === "image") return { type: "image", image: "[redacted]" };
        return { type: String((p as any)?.type ?? "unknown") };
      });
    }
    return "[unsupported-content]";
  }
}


