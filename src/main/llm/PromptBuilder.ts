import type { CoreMessage } from "ai";

export const MAX_CONTEXT_LENGTH = 4000;
export const DEFAULT_TEMPERATURE = 0.7;
export const APPLE_TEMPERATURE = 0.4;

export class PromptBuilder {
  buildAppleSystem(): CoreMessage {
    return {
      role: "system",
      content: [
        "You are a helpful on-device assistant running locally on the user's Mac.",
        "You do not have direct network access. Only use tools when the user explicitly asks to open a URL or asks about the current page.",
        "If the user provides a URL or asks to open/visit a page, call the open_url tool then continue the answer using the returned page info.",
        "If the user asks what page they are on or about the current page, you may use get_page_info.",
        "Do not call tools for casual greetings, general questions, or small talk. Respond directly without tools unless the user explicitly requests navigation or page information.",
        "Be concise, factual, and reference the provided page context or tool results when relevant.",
        "If information is not present in the context or tool results, say you don't know.",
      ].join(" "),
    };
  }

  buildAppleContext(url: string | null, title: string | null, pageText: string | null): CoreMessage | null {
    const parts: string[] = [];
    if (url) parts.push(`URL: ${url}`);
    if (title) parts.push(`Title: ${title}`);
    // Provide a short, whitespace-normalized excerpt of the page text for extra context (no images)
    if (pageText) {
      const normalized = pageText.replace(/\s+/g, " ").trim();
      const excerpt = this.truncate(normalized, Math.min(800, MAX_CONTEXT_LENGTH));
      if (excerpt) parts.push(`Excerpt: ${excerpt}`);
    }
    if (parts.length === 0) return null;
    return { role: "assistant", content: `Page Context\n${parts.join("\n\n")}\n\nUse this context to answer the next questions.` };
  }

  buildOnlineSystem(url: string | null, pageText: string | null, title: string | null): CoreMessage {
    const lines: string[] = [
      "You are a helpful AI assistant integrated into a web browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include screenshots of the current page as the first image.",
      "If you use any tools, always continue with a clear, final answer to the user's request after the tool results are available.",
      "When opening a link, briefly summarize the opened page and proceed to answer the user's question using that context.",
    ];
    if (url) lines.push(`\nCurrent page URL: ${url}`);
    if (title) lines.push(`\nPage title: ${title}`);
    if (pageText) lines.push(`\nPage content (text):\n${this.truncate(pageText, MAX_CONTEXT_LENGTH)}`);
    lines.push(
      "\nPlease provide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided.",
    );
    return { role: "system", content: lines.join("\n") };
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }
}


