import { streamText, type CoreMessage, type LanguageModel } from "ai";
import type { ToolBundle } from "./Tools";
import { APPLE_TEMPERATURE, DEFAULT_TEMPERATURE } from "./PromptBuilder";
import type { MessageStore } from "../chat/MessageStore";

export class Streamer {
  constructor(private messages: MessageStore) {}

  async run(
    model: LanguageModel,
    provider: string,
    messages: CoreMessage[],
    tools: ToolBundle,
    toolChoice: "auto" | "none",
  ): Promise<string> {
    const result = await streamText({
      model,
      messages,
      temperature: provider === "apple" ? APPLE_TEMPERATURE : DEFAULT_TEMPERATURE,
      maxRetries: provider === "apple" ? 0 : 3,
      abortSignal: undefined,
      tools,
      toolChoice,
    });
    return await this.consume(result.textStream);
  }

  async simple(
    model: LanguageModel,
    provider: string,
    messages: CoreMessage[],
    tools?: ToolBundle,
  ): Promise<string> {
    const args: any = {
      model,
      messages,
      temperature: provider === "apple" ? APPLE_TEMPERATURE : DEFAULT_TEMPERATURE,
      maxRetries: 2,
    };
    if (tools) args.tools = tools;
    const result = await streamText(args);
    return await this.consume(result.textStream);
  }

  private async consume(textStream: AsyncIterable<string>): Promise<string> {
    let finalText = "";
    let first = true;
    for await (const chunk of textStream) {
      if (!chunk) continue;
      finalText += chunk;
      if (first) {
        this.messages.beginStream(chunk);
        first = false;
      } else {
        this.messages.appendStream(chunk);
      }
    }
    if (!first) this.messages.endStream();
    return finalText;
  }

  // Public wrapper to consume an external text stream (e.g., Apple native chat())
  async consumeExternalStream(textStream: AsyncIterable<string>): Promise<string> {
    return this.consume(textStream);
  }
}


