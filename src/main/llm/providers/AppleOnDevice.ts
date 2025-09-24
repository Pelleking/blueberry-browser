import type { LanguageModel } from "ai";

function ensureSupportedLocale(): void {
  const fallbackLocale = "en_US.UTF-8";
  if (!process.env.LANG || /^c(\.|$)/i.test(process.env.LANG)) {
    process.env.LANG = fallbackLocale;
  }
  if (!process.env.LC_ALL || /^c(\.|$)/i.test(process.env.LC_ALL)) {
    process.env.LC_ALL = fallbackLocale;
  }
  if (!process.env.LANGUAGE) {
    process.env.LANGUAGE = "en_US";
  }
}

export interface AppleAvailability {
  available: boolean;
  reason: string;
}

export async function checkAppleAvailability(): Promise<AppleAvailability> {
  try {
    ensureSupportedLocale();
    const mod = await import("@meridius-labs/apple-on-device-ai");
    const info = await mod.appleAISDK.checkAvailability();

    // Log detailed locale info for debugging
    console.log("=== Apple Locale Debug ===");
    console.log("process.env.LANG:", process.env.LANG);
    console.log("process.env.LC_ALL:", process.env.LC_ALL);
    console.log(
      "Intl.DateTimeFormat().resolvedOptions():",
      JSON.stringify(Intl.DateTimeFormat().resolvedOptions(), null, 2),
    );

    // Get supported languages for comparison
    try {
      const supported = await mod.appleAISDK.getSupportedLanguages();
      console.log("Apple supported languages:", supported);
    } catch (error) {
      console.log("Could not get supported languages:", error);
    }

    console.log("Apple availability check:", info);
    console.log("=== End Apple Locale Debug ===");
    
    return { available: info.available, reason: info.reason };
  } catch (error) {
    console.log("Apple availability check failed:", error);
    return { available: false, reason: "unavailable-or-not-installed" };
  }
}

export function createAppleLanguageModel(): LanguageModel {
  // Note: This function should only be called after availability check passes
  // Dynamic import to avoid loading native module on unsupported systems
  const anyGlobal = global as unknown as { __appleAIModel?: LanguageModel };
  if (anyGlobal.__appleAIModel) {
    return anyGlobal.__appleAIModel;
  }
  // Synchronous wrapper; in our usage we call after an awaited check
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("@meridius-labs/apple-on-device-ai");
  const model = mod.appleAI("apple-on-device") as unknown as LanguageModel;
  anyGlobal.__appleAIModel = model;
  return model;
}

export type AppleChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function appleChatStream(options: {
  messages: string | AppleChatMessage[];
  tools?: Array<unknown>;
}): Promise<AsyncIterable<string>> {
  const mod = await import("@meridius-labs/apple-on-device-ai");
  return mod.chat({ ...options, stream: true });
}

export async function appleChat(options: {
  messages: string | AppleChatMessage[];
}): Promise<{ text: string }> {
  const mod = await import("@meridius-labs/apple-on-device-ai");
  const res = await mod.chat(options);
  return { text: res.text };
}

// Normalize native stream to text-only chunks for our streamer
export async function appleTextStream(options: {
  messages: string | AppleChatMessage[];
  tools?: Array<unknown>;
}): Promise<AsyncIterable<string>> {
  const mod = await import("@meridius-labs/apple-on-device-ai");
  const raw = await mod.chat({ ...options, stream: true });
  async function* toText(): AsyncIterable<string> {
    for await (const delta of raw as AsyncIterable<unknown>) {
      if (typeof delta === "string") {
        yield delta;
        continue;
      }
      const anyDelta = delta as { type?: string; text?: string };
      if (anyDelta && anyDelta.type === "text" && typeof anyDelta.text === "string") {
        yield anyDelta.text;
      }
      // Ignore other event types (tool-call/tool-result) for text streaming
    }
  }
  return toText();
}


