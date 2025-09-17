import type { LanguageModel } from "ai";

export interface AppleAvailability {
  available: boolean;
  reason: string;
}

export async function checkAppleAvailability(): Promise<AppleAvailability> {
  try {
    const mod = await import("@meridius-labs/apple-on-device-ai");
    const info = await mod.appleAISDK.checkAvailability();
    return { available: info.available, reason: info.reason };
  } catch {
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
  const model = (mod.appleAI("apple-on-device") as unknown) as LanguageModel;
  anyGlobal.__appleAIModel = model;
  return model;
}
