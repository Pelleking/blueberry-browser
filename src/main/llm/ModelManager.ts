import type { LanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { checkAppleAvailability, createAppleLanguageModel } from "./providers/AppleOnDevice";

type OnlineProvider = "openai" | "anthropic";
type LLMProvider = OnlineProvider | "apple";

const DEFAULT_MODELS: Record<OnlineProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
};

export class ModelManager {
  private baseOnlineProvider: OnlineProvider;
  private provider: LLMProvider;
  private modelName: string | null = null;
  private model: LanguageModel | null = null;
  private offlineMode: boolean;
  private appleAvailabilityChecked: boolean = false;
  private appleAvailable: boolean = false;
  private appleUnavailableReason: string | null = null;

  constructor() {
    this.baseOnlineProvider = this.getBaseOnlineProvider();
    this.offlineMode = this.getInitialOfflineMode();
    this.provider = this.offlineMode ? "apple" : this.baseOnlineProvider;
    this.modelName = this.getModelName();
  }

  async init(): Promise<void> {
    await this.initializeModel();
  }

  async setOfflineMode(enabled: boolean): Promise<boolean> {
    if (this.offlineMode === enabled) return this.offlineMode;
    if (enabled) {
      this.provider = "apple";
      this.modelName = this.getModelName();
      await this.initializeModel();
      if (!this.model) {
        this.provider = this.baseOnlineProvider;
        this.modelName = this.getModelName();
        await this.initializeModel();
        this.offlineMode = false;
        return false;
      }
      this.offlineMode = true;
      return true;
    }
    this.provider = this.baseOnlineProvider;
    this.modelName = this.getModelName();
    await this.initializeModel();
    this.offlineMode = false;
    return false;
  }

  getModel(): LanguageModel | null {
    return this.model;
  }

  getProvider(): LLMProvider {
    return this.provider;
  }

  getModelName(): string | null {
    if (this.provider === "apple") return null;
    return process.env.LLM_MODEL || DEFAULT_MODELS[this.baseOnlineProvider];
  }

  isOffline(): boolean {
    return this.offlineMode;
  }

  getAppleUnavailableReason(): string | null {
    return this.appleUnavailableReason;
  }

  private getInitialOfflineMode(): boolean {
    const fromEnv = (process.env.OFFLINE_MODE || "").toLowerCase();
    const providerEnv = (process.env.LLM_PROVIDER || "").toLowerCase();
    if (fromEnv === "1" || fromEnv === "true" || providerEnv === "apple") return true;
    return false;
  }

  private getBaseOnlineProvider(): OnlineProvider {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    return "openai";
  }

  private async initializeModel(): Promise<void> {
    if (this.provider === "apple") {
      if (!this.appleAvailabilityChecked) {
        const availability = await checkAppleAvailability();
        this.appleAvailable = availability.available;
        this.appleUnavailableReason = availability.reason || null;
        this.appleAvailabilityChecked = true;
      }
      if (!this.appleAvailable) {
        this.model = null;
        return;
      }
      try {
        this.model = createAppleLanguageModel();
      } catch (e) {
        this.model = null;
        this.appleAvailable = false;
        this.appleUnavailableReason = `load-failed:${(e as Error)?.message || "unknown"}`;
      }
      return;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.model = null;
      return;
    }
    switch (this.baseOnlineProvider) {
      case "anthropic":
        this.model = anthropic(this.modelName || DEFAULT_MODELS.anthropic);
        break;
      case "openai":
      default:
        this.model = openai(this.modelName || DEFAULT_MODELS.openai);
        break;
    }
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
}


