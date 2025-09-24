import { WebContents } from "electron";
import type { BridgeChatEmitter } from "./BridgeServer";
import type { LanguageModel, CoreMessage } from "ai";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";
import { PageInspector } from "./page/PageInspector";
import type { PageInfo } from "./common/types";
import { ModelManager } from "./llm/ModelManager";
import { PromptBuilder } from "./llm/PromptBuilder";
import { MessageStore } from "./chat/MessageStore";
import { Streamer } from "./llm/Streamer";
import { buildTools } from "./llm/Tools";
import type { ToolBundle } from "./llm/Tools";
import { buildNativeTools } from "./llm/Tools";
import { appleTextStream } from "./llm/providers/AppleOnDevice";
import { Logger } from "./llm/Logger";

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

interface ChatRequest {
  message: string;
  messageId: string;
}

interface StreamChunk {
  content: string;
  isComplete: boolean;
}

type OnlineProvider = "openai" | "anthropic";
type LLMProvider = OnlineProvider | "apple";

// Note: Images are not currently attached to messages. Keep text-only for consistency across providers.

const DEFAULT_MODELS: Record<OnlineProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
};

const MAX_CONTEXT_LENGTH = 4000;

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private inspector: PageInspector | null = null;
  private bridgeEmitter: BridgeChatEmitter | null = null;
  private modelManager: ModelManager;
  private promptBuilder: PromptBuilder;
  private messageStore: MessageStore;
  private streamer: Streamer;
  private logger: Logger;
  private lastToolResult: {
    title: string | null;
    url: string | null;
    summary: string;
    links: Array<{ text: string; href: string }>;
  } | null = null;
  private baseOnlineProvider: OnlineProvider;
  private provider: LLMProvider;
  private modelName: string | null = null;
  private model: LanguageModel | null = null;
  private messages: CoreMessage[] = [];
  private offlineMode: boolean;
  private appleAvailable: boolean = false;
  private appleUnavailableReason: string | null = null;
  private didAppleLocaleFallback: boolean = false;

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.modelManager = new ModelManager();
    this.promptBuilder = new PromptBuilder();
    this.messageStore = new MessageStore(this.webContents);
    this.streamer = new Streamer(this.messageStore);
    this.logger = new Logger((process.env.APPLE_AI_DEBUG || "").toLowerCase() === "1" || (process.env.LLM_DEBUG || "").toLowerCase() === "1");
    this.baseOnlineProvider = this.getBaseOnlineProvider();
    this.offlineMode = this.getInitialOfflineMode();
    this.provider = this.offlineMode ? "apple" : this.baseOnlineProvider;
    this.modelName = this.getModelName();
    void this.modelManager.init().then(() => {
      this.syncFromManager();
      this.logInitializationStatus();
    });
  }

  // Set the window reference after construction to avoid circular dependencies
  setWindow(window: Window): void {
    this.window = window;
    try { this.inspector = new PageInspector(window); } catch { /* ignore */ }
  }

  // Optional: allow an external bridge to receive chat/events
  setBridgeEmitter(bridge: BridgeChatEmitter): void {
    this.bridgeEmitter = bridge;
    try { this.messageStore.setBridge(bridge); } catch { /* ignore */ }
  }

  // Public offline controls
  getOfflineMode(): boolean {
    return this.offlineMode;
  }

  async setOfflineMode(enabled: boolean): Promise<boolean> {
    const result = await this.modelManager.setOfflineMode(enabled);
    this.syncFromManager();
    this.logInitializationStatus();
    return result;
  }

  private getInitialOfflineMode(): boolean {
    const fromEnv = (process.env.OFFLINE_MODE || "").toLowerCase();
    const providerEnv = (process.env.LLM_PROVIDER || "").toLowerCase();
    if (fromEnv === "1" || fromEnv === "true" || providerEnv === "apple") {
      return true;
    }
    return false;
  }

  private getBaseOnlineProvider(): OnlineProvider {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    return "openai"; // Default to OpenAI
  }

  private getModelName(): string | null {
    if (this.provider === "apple") return null; // Apple provider does not require model name
    return process.env.LLM_MODEL || DEFAULT_MODELS[this.baseOnlineProvider];
  }

  private async initializeModel(): Promise<void> {
    // Kept for backward compatibility; prefer ModelManager.init()
    await this.modelManager.init();
    this.syncFromManager();
  }

  private getApiKey(): string | undefined {
    switch (this.baseOnlineProvider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY;
      case "openai":
        return process.env.OPENAI_API_KEY;
      default:
        return undefined;
    }
  }

  private logInitializationStatus(): void {
    if (this.provider === "apple") {
      if (this.model) {
        console.log(
          "✅ LLM Client initialized in OFFLINE mode using Apple on-device AI"
        );
      } else {
        console.error(
          "❌ LLM Client offline initialization failed: Apple on-device AI is not available on this system." +
            (this.appleUnavailableReason ? ` Reason: ${this.appleUnavailableReason}` : "")
        );
      }
      return;
    }

    if (this.model) {
      console.log(
        `✅ LLM Client initialized with ${this.baseOnlineProvider} provider using model: ${this.modelName}`
      );
    } else {
      const keyName =
        this.baseOnlineProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.error(
        `❌ LLM Client initialization failed: ${keyName} not found in environment variables.\n` +
          `Please add your API key to the .env file in the project root.`
      );
    }
  }

  private syncFromManager(): void {
    try {
      this.model = this.modelManager.getModel();
      // Cast is safe because ModelManager only returns known providers
      this.provider = this.modelManager.getProvider() as unknown as LLMProvider;
      this.modelName = this.modelManager.getModelName();
      this.offlineMode = this.modelManager.isOffline();
      this.appleUnavailableReason = this.modelManager.getAppleUnavailableReason();
      // Consider Apple available when a model instance exists
      this.appleAvailable = !!this.model;
    } catch {
      // ignore
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      // Always append the user's message immediately so it shows up in the UI
      this.messageStore.addUser(request.message);
      // Mirror user chat to external bridge
      try { this.bridgeEmitter?.emitChat({ role: "user", text: request.message }); } catch { /* ignore */ }

      // Preflight: if using online provider, ensure we have API key and network; otherwise auto-switch to offline
      if (this.provider !== "apple") {
        const haveKey = !!this.getApiKey();
        if (!haveKey) {
          const switched = await this.setOfflineMode(true);
          if (switched) this.broadcastOfflineMode(true);
        } else {
          const online = await this.isOnline();
          if (!online) {
            const switched = await this.setOfflineMode(true);
            if (switched) this.broadcastOfflineMode(true);
          }
        }
      }

      if (this.provider === "apple" && (!this.model || !this.appleAvailable)) {
        const err = "Apple on-device AI is unavailable. Ensure macOS with Apple Intelligence is enabled.";
        this.addAssistantMessage(err);
        this.sendErrorMessage(request.messageId, err);
        return;
      }

      // Screenshots currently disabled to simplify context and avoid unsupported inputs for Apple

      // Optionally enhance the most recent user message with a screenshot (if available and not Apple)
      // For simplicity, we currently keep the user message as text-only to avoid complex replacement logic.

      // Intercept deterministic queries (e.g., "what page am I on?")
      if (this.detectWhatPageQuestion(request.message)) {
        try {
          const active = this.window?.activeTab;
          const reply = active
            ? `You are on: ${active.title || "(untitled)"} — ${active.url || "(no url)"}`
            : "There is no active tab right now.";
          this.addAssistantMessage(reply);
      try { this.bridgeEmitter?.emitChat({ role: "assistant", text: reply }); } catch { /* ignore */ }
          return;
        } catch {
          // ignore
        }
      }

      if (!this.model) {
        const message =
          this.provider === "apple"
            ? "Apple on-device AI is unavailable."
            : "LLM service is not configured. Please add your API key to the .env file.";
        this.sendErrorMessage(request.messageId, message);
        return;
      }

      // Apple-specific: intercept explicit navigation requests with URLs and handle directly (no tool call)
      if (this.provider === "apple") {
        const userText = this.extractLastUserText();
        const urlMatch = userText.match(/https?:\/\/\S+/i);
        const wantsOpen = /(\bopen\b|\bvisit\b|\bgo to\b|\bnavigate\b)/i.test(userText);
        if (urlMatch && wantsOpen) {
          await this.openUrlAndSummarize(urlMatch[0]);
          return;
        }
      }

      const messages = await this.prepareMessagesWithContext();
      // Log outgoing request once per turn for debugging
      try {
        this.logOutgoingRequest(messages);
      } catch {}
      const tools = this.buildToolBundle();
      // For Apple on-device, route via native chat API for tool support; otherwise use AI SDK streamText
      const lastUserText = this.extractLastUserText();
      let finalText = "";
      if (this.provider === "apple") {
        // Always provide native tools; the model will call them when appropriate
        console.log(`[LLM:apple] route=native-chat+tools`);
        const nativeTools = buildNativeTools(
          this.inspector as PageInspector,
          (evt) => {
            try {
              this.bridgeEmitter?.emitEvent(evt);
            } catch {
              /* ignore */
            }
          },
          (info) => {
            this.lastToolResult = info;
          },
        );
        try { console.log(`[LLM:apple] native tools: ${nativeTools.map((t) => t.name).join(", ")}`); } catch {}
        const stream = await appleTextStream({ messages: messages as unknown as any, tools: nativeTools as unknown as any[] });
        finalText = await this.streamer.consumeExternalStream(stream as unknown as AsyncIterable<string>);
      } else {
        console.log(`[LLM:${this.provider}] route=ai-sdk tools=auto`);
        finalText = await this.streamer.run(this.model, this.provider, messages, tools, "auto");
      }

      // Fallback: run a clean, tool-free follow-up to avoid double tool calls
      if (finalText.trim().length === 0 && this.lastToolResult) {
        const userPrompt = this.extractLastUserText();
        const pageInfoText = [
          this.lastToolResult.url ? `URL: ${this.lastToolResult.url}` : "",
          this.lastToolResult.title ? `Title: ${this.lastToolResult.title}` : "",
          this.lastToolResult.summary ? `Summary: ${this.truncateForLog(this.lastToolResult.summary, 1200)}` : "",
        ].filter(Boolean).join("\n");
        const followupMessages: CoreMessage[] = [
          { role: "system", content: "Use the provided page info to answer the user's request clearly and completely." },
          { role: "user", content: `Page Info\n${pageInfoText}\n\nQuestion: ${userPrompt}` },
        ];
        await this.streamer.simple(this.model, this.provider, followupMessages);
        this.lastToolResult = null;
      }
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  clearMessages(): void {
    this.messageStore.clear();
  }

  // Remove QR code prompt messages injected as markdown data: URLs
  removeQrMessages(): void {
    try {
      const filtered = this.messageStore.getAll().filter((m) => {
        if (m.role !== "assistant") return true;
        if (typeof m.content !== "string") return true;
        return !m.content.includes("data:image/png;base64");
      });
      this.messageStore.setAll(filtered);
    } catch { /* ignore */ }
  }

  // Bridge helper: notify current active tab
  notifyActiveTab(url: string, tabId: string): void {
    try {
      this.bridgeEmitter?.emitEvent({ name: "activeTab", data: { tabId, url } });
    } catch {
      /* ignore */
    }
  }

  // Open URL in a new tab, wait for load, fetch basic info, and append a brief summary into chat
  async openUrlAndSummarize(url: string): Promise<void> {
    try {
      if (!this.inspector || !this.window) return;
      const info = await this.inspector.openUrlAndGetInfo(url);
      const title = info.title || "(untitled)";
      const summary = (info.summary || "").split(/\s+/).slice(0, 80).join(" ");

      const assistantMessage: CoreMessage = {
        role: "assistant",
        content: [
          `Opened ${url}`,
          title ? `Title: ${title}` : "",
          summary ? `Summary: ${summary}…` : "",
        ].filter(Boolean).join("\n"),
      };
      this.messages.push(assistantMessage);
      this.sendMessagesToRenderer();
      try {
        this.bridgeEmitter?.emitEvent({ name: "pageOpened", data: { url, title } });
        if (summary) this.bridgeEmitter?.emitChat({ role: "assistant", text: `Opened ${url} — ${summary.slice(0, 140)}…` });
      } catch { /* ignore */ }
    } catch {
      this.addAssistantMessage(`Failed to open ${url}`);
    }
  }

  private async openUrlAndGetInfo(url: string): Promise<PageInfo & { url: string }> {
    if (!this.inspector) throw new Error("No window");
    const info = await this.inspector.openUrlAndGetInfo(url);
    try {
      this.bridgeEmitter?.emitEvent({ name: "activeTab", data: { tabId: this.window?.activeTab?.id, url } });
    } catch {
      /* ignore */
    }
    return info;
  }

  private async getActivePageInfo(): Promise<PageInfo> {
    if (!this.inspector) return { title: null, url: null, summary: "", links: [] };
    return await this.inspector.getActivePageInfo();
  }

  getMessages(): CoreMessage[] {
    return this.messageStore.getAll();
  }

  // Inject a plain assistant message (e.g., notifications)
  addAssistantMessage(content: string): void {
    this.messageStore.addAssistant(content);
  }

  getAppleUnavailableReason(): string | null {
    return this.appleUnavailableReason;
  }

  private sendMessagesToRenderer(): void {
    // Ensure any external listeners refresh; MessageStore already emits on changes
    this.messageStore.setAll(this.messageStore.getAll());
  }

  private async prepareMessagesWithContext(): Promise<CoreMessage[]> {
    // Get page context from active tab
    let pageUrl: string | null = null;
    let pageText: string | null = null;
    let pageTitle: string | null = null;
    
    if (this.window) {
      const activeTab = this.window.activeTab;
      if (activeTab) {
        pageUrl = activeTab.url;
        pageTitle = activeTab.title;
        try {
          pageText = await activeTab.getTabText();
        } catch (error) {
          console.error("Failed to get page text:", error);
        }
      }
    }

    // Provider-specific context formatting
    if (this.provider === "apple") {
      // Apple on-device models respond more consistently with a minimal system prompt
      // and the page context provided as a separate user message.
      const systemMessage = this.promptBuilder.buildAppleSystem();
      const contextMessage = this.promptBuilder.buildAppleContext(pageUrl, pageTitle, pageText);
      const history = this.messageStore.getAll();
      return contextMessage ? [systemMessage, contextMessage, ...history] : [systemMessage, ...history];
    }

    // Default (online providers): keep context in system prompt
    const systemMessage: CoreMessage = this.promptBuilder.buildOnlineSystem(pageUrl, pageText, pageTitle);
    return [systemMessage, ...this.messageStore.getAll()];
  }

  private buildSystemPrompt(url: string | null, pageText: string | null, title: string | null): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include screenshots of the current page as the first image.",
      "If you use any tools, always continue with a clear, final answer to the user's request after the tool results are available.",
      "When opening a link, briefly summarize the opened page and proceed to answer the user's question using that context.",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (title) {
      parts.push(`\nPage title: ${title}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage content (text):\n${truncatedText}`);
    }

    parts.push(
      "\nPlease provide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided."
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private detectWhatPageQuestion(text: string): boolean {
    try {
      const lower = text.toLowerCase();
      // very simple heuristics including common typos
      const patterns = [
        /what\s+page\s+am\s+i\s+on/, // exact
        /what\s+page\s+am\s+i\s+on\?/,
        /what\s+page\s+am\s+i\s+on\b/,
        /what\s+page\s+is\s+this/,
        /which\s+page\s+am\s+i\s+on/,
        /what\s+site\s+am\s+i\s+on/,
        /what\s+url\s+am\s+i\s+on/,
        /what\s+apge\s+am\s+i\s+on/, // common typo in provided logs
      ];
      return patterns.some((re) => re.test(lower));
    } catch {
      return false;
    }
  }

  private buildToolBundle(): ToolBundle {
    const inspector = this.inspector as PageInspector;
    const emit = (evt: { name: string; data: unknown }): void => {
      try {
        this.bridgeEmitter?.emitEvent(evt);
      } catch {
        /* ignore */
      }
    };
    const setLast = (info: PageInfo): void => {
      this.lastToolResult = info;
    };
    return buildTools(inspector, emit, setLast);
  }

  private extractLastUserText(): string {
    try {
      const all = this.messageStore.getAll();
      for (let i = all.length - 1; i >= 0; i--) {
        const m = all[i];
        if (m.role === "user") {
          if (typeof m.content === "string") return m.content;
          if (Array.isArray(m.content)) {
            type TextPart = { type?: string; text?: string };
            const textPart = (m.content as TextPart[]).find((p: TextPart) => p?.type === "text");
            return String(textPart?.text || "");
          }
        }
      }
    } catch { /* ignore */ }
    return "";
  }

  private async processStream(
    textStream: AsyncIterable<string>,
    messageId: string
  ): Promise<string> {
    let accumulatedText = "";
    let messageIndex: number | null = null;

    for await (const chunk of textStream) {
      if (!chunk) continue;
      accumulatedText += chunk;

      // Lazily insert assistant message on first chunk
      if (messageIndex === null) {
        messageIndex = this.messages.length;
        this.messages.push({ role: "assistant", content: chunk });
      } else {
        this.messages[messageIndex] = { role: "assistant", content: accumulatedText };
      }
      this.sendMessagesToRenderer();

      this.sendStreamChunk(messageId, { content: chunk, isComplete: false });

      // Stream assistant chunks to bridge
      try { this.bridgeEmitter?.emitChat({ role: "assistant", text: chunk }); } catch { /* ignore */ }
    }

    if (messageIndex !== null) {
      // Final update with complete content
      this.messages[messageIndex] = { role: "assistant", content: accumulatedText };
      this.sendMessagesToRenderer();

      // Final complete signal
      this.sendStreamChunk(messageId, { content: accumulatedText, isComplete: true });

      try { if (accumulatedText) this.bridgeEmitter?.emitChat({ role: "assistant", text: accumulatedText }); } catch { /* ignore */ }
    }
    // If no chunks were produced, avoid pushing an empty assistant message entirely
    return accumulatedText;
  }

  private handleStreamError(error: unknown, messageId: string): void {
    console.error("Error streaming from LLM:", error);

    // Log detailed locale info when Apple fails
    if (this.provider === "apple" && error instanceof Error && /unsupported language|unsupported locale|locale was used/i.test(error.message)) {
      console.log("=== Apple Stream Error Locale Debug ===");
      console.log("Current provider:", this.provider);
      console.log("Error message:", error.message);
      console.log("Error code:", (error as any).code);
      console.log("process.env.LANG:", process.env.LANG);
      console.log("process.env.LC_ALL:", process.env.LC_ALL);
      console.log("Intl.DateTimeFormat().resolvedOptions():", JSON.stringify(Intl.DateTimeFormat().resolvedOptions(), null, 2));
      try {
        console.log("Intl.Locale details:", JSON.stringify(new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale), null, 2));
      } catch (e) {
        console.log("Could not create Intl.Locale:", e);
      }
      console.log("=== End Apple Stream Error Debug ===");
    }

    const errorMessage = this.getErrorMessage(error);

    // Auto-fallback: If Apple model fails due to unsupported locale, switch to online and retry once
    if (
      this.provider === "apple" &&
      !this.didAppleLocaleFallback &&
      error instanceof Error &&
      /unsupported language|unsupported locale|locale was used/i.test(error.message)
    ) {
      void (async () => {
        try {
          this.didAppleLocaleFallback = true;
          this.addAssistantMessage("Apple on-device AI is unavailable for this locale. Switching to online model...");
          const switched = await this.setOfflineMode(false);
          if (switched === false && this.provider !== "apple") {
            this.broadcastOfflineMode(false);
          }
          if (!this.model) {
            this.sendErrorMessage(messageId, errorMessage);
            return;
          }
          const messages = await this.prepareMessagesWithContext();
          const tools = this.buildToolBundle();
          const finalText = await this.streamer.run(this.model, this.provider, messages, tools, "auto");
          if (!finalText) this.sendErrorMessage(messageId, errorMessage);
        } catch {
          this.sendErrorMessage(messageId, errorMessage);
        }
      })();
      return;
    }

    this.sendErrorMessage(messageId, errorMessage);
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "An unexpected error occurred. Please try again.";
    }

    const message = error.message.toLowerCase();

    // Apple on-device specific: unsupported locale/language
    if (message.includes("unsupported language") || message.includes("unsupported locale") || message.includes("locale was used")) {
      return "Apple on-device AI isn't available for your current macOS language/locale. Set System Language to a supported language (e.g., English) and ensure Apple Intelligence is enabled. Then retry.";
    }

    if (message.includes("401") || message.includes("unauthorized")) {
      return "Authentication error: Please check your API key in the .env file.";
    }

    if (message.includes("429") || message.includes("rate limit")) {
      return "Rate limit exceeded. Please try again in a few moments.";
    }

    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused")
    ) {
      return "Network error: Please check your internet connection.";
    }

    if (message.includes("timeout")) {
      return "Request timeout: The service took too long to respond. Please try again.";
    }

    return "Sorry, I encountered an error while processing your request. Please try again.";
  }

  private sendErrorMessage(messageId: string, errorMessage: string): void {
    this.sendStreamChunk(messageId, {
      content: errorMessage,
      isComplete: true,
    });
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", {
      messageId,
      content: chunk.content,
      isComplete: chunk.isComplete,
    });
  }

  private broadcastOfflineMode(enabled: boolean): void {
    try {
      if (!this.window) return;
      // Notify topbar
      this.window.topBar.view.webContents.send("offline-mode-updated", enabled);
      // Notify sidebar (optional)
      this.window.sidebar.view.webContents.send("offline-mode-updated", enabled);
      // Notify bridge
      try {
        this.bridgeEmitter?.emitEvent({ name: "featureState", data: { offlineMode: enabled } });
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }

  private async isOnline(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dns = require("dns");
        let settled = false;
        const done = (res: boolean): void => {
          if (!settled) {
            settled = true;
            resolve(res);
          }
        };
        const timer = setTimeout(() => done(false), 1000);
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

  private shouldLogDebug(): boolean {
    const a = (process.env.APPLE_AI_DEBUG || "").toLowerCase() === "1";
    const b = (process.env.LLM_DEBUG || "").toLowerCase() === "1";
    return a || b;
  }

  private truncateForLog(text: string, max = 500): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + ` ...[+${text.length - max} chars]`;
  }

  private sanitizeContent(content: CoreMessage["content"]): unknown {
    if (typeof content === "string") {
      return this.truncateForLog(content);
    }
    if (Array.isArray(content)) {
      type MinimalPart = { type?: string; text?: string; image?: string };
      return (content as MinimalPart[]).map((part: MinimalPart) => {
        if (part?.type === "text") {
          return { type: "text", text: this.truncateForLog(String(part.text || "")) };
        }
        if (part?.type === "image") {
          return { type: "image", image: "[redacted]" };
        }
        return { type: String(part?.type ?? "unknown") };
      });
    }
    return "[unsupported-content]";
  }

  private logOutgoingRequest(messages: CoreMessage[]): void {
    try {
      const includesScreenshot = messages.some((m) => {
        if (!Array.isArray(m.content)) return false;
        type MinimalPart = { type?: string };
        const parts = m.content as MinimalPart[];
        return parts.some((p) => p?.type === "image");
      });
      const provider = this.provider;
      const model = this.modelName || "apple-on-device";
      const summary = messages.map((m) => ({
        role: m.role,
        content: this.sanitizeContent(m.content),
      }));
      console.log(`[LLM:${provider}] model=${model} screenshot=${includesScreenshot}`);
      console.log("[LLM] Outgoing request (redacted):", JSON.stringify(summary, null, 2));
    } catch (e) {
      console.warn("[LLM] Failed to log request", e);
    }
  }
}
