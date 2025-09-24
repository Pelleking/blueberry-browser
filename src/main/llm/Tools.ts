import { z } from "zod";
import { tool } from "ai";
import type { PageInfo } from "../common/types";
import type { PageInspector } from "../page/PageInspector";

export type ToolBundle = ReturnType<typeof buildTools>;

export function buildTools(
  inspector: PageInspector,
  emit: (evt: { name: string; data: unknown }) => void,
  setLast: (info: PageInfo) => void,
) {
  return {
    open_url: tool({
      description: "Open a URL in a new tab and return page info (title, url, summary, links). Use when the user asks to open/visit a link.",
      inputSchema: z.object({ url: z.string().describe("The URL to open.") }),
      execute: async (input: { url: string }) => {
        try {
          try { emit({ name: "toolCall", data: { name: "open_url", input } }); } catch { /* ignore */ }
          const info = await inspector.openUrlAndGetInfo(input.url);
          setLast(info);
          try { emit({ name: "toolResult", data: { name: "open_url", result: { title: info.title, url: info.url, linksCount: info.links?.length ?? 0 } } }); } catch { /* ignore */ }
          return info as unknown as Record<string, unknown>;
        } catch (e) {
          return { error: String((e as Error)?.message || e || "failed") } as Record<string, unknown>;
        }
      },
    }),
    get_page_info: tool({
      description: "Get information about the currently active page (title, url, summary, top links). Use when the user asks questions about the current page.",
      inputSchema: z.object({}).optional(),
      execute: async () => {
        try {
          const info = await inspector.getActivePageInfo();
          setLast(info);
          try { emit({ name: "toolResult", data: { name: "get_page_info", result: { title: info.title, url: info.url, linksCount: info.links?.length ?? 0 } } }); } catch { /* ignore */ }
          return info as unknown as Record<string, unknown>;
        } catch (e) {
          return { error: String((e as Error)?.message || e || "failed") } as Record<string, unknown>;
        }
      },
    }),
  } as const;
}

// Native (Apple SDK) tool definitions for use with @meridius-labs/apple-on-device-ai chat()
export function buildNativeTools(
  inspector: PageInspector,
  emit: (evt: { name: string; data: unknown }) => void,
  setLast: (info: PageInfo) => void,
) {
  const nativeTools = [
    {
      name: "open_url",
      description:
        "Open a URL in a new tab and return page info (title, url, summary, links). Use when the user asks to open/visit a link.",
      jsonSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to open." },
        },
        required: ["url"],
      },
      handler: async ({ url }: { url: string }) => {
        try {
          try {
            emit({ name: "toolCall", data: { name: "open_url", input: { url } } });
          } catch {
            /* ignore */
          }
          const info = await inspector.openUrlAndGetInfo(url);
          setLast(info);
          try {
            const linksLimited = Array.isArray(info.links) ? info.links.slice(0, 8) : [];
            const summaryShort = (info.summary || "").slice(0, 300);
            emit({
              name: "toolResult",
              data: {
                name: "open_url",
                result: {
                  title: info.title,
                  url: info.url,
                  linksCount: info.links?.length ?? 0,
                  summaryShort,
                  links: linksLimited,
                },
              },
            });
          } catch {
            /* ignore */
          }
          return info as unknown as Record<string, unknown>;
        } catch (e) {
          return { error: String((e as Error)?.message || e || "failed") } as Record<string, unknown>;
        }
      },
    },
    {
      name: "get_page_info",
      description:
        "Get information about the currently active page (title, url, summary, top links). Use when the user asks questions about the current page.",
      jsonSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        try {
          const info = await inspector.getActivePageInfo();
          setLast(info);
          try {
            const linksLimited = Array.isArray(info.links) ? info.links.slice(0, 8) : [];
            const summaryShort = (info.summary || "").slice(0, 300);
            emit({
              name: "toolResult",
              data: {
                name: "get_page_info",
                result: {
                  title: info.title,
                  url: info.url,
                  linksCount: info.links?.length ?? 0,
                  summaryShort,
                  links: linksLimited,
                },
              },
            });
          } catch {
            /* ignore */
          }
          return info as unknown as Record<string, unknown>;
        } catch (e) {
          return { error: String((e as Error)?.message || e || "failed") } as Record<string, unknown>;
        }
      },
    },
  ];
  return nativeTools;
}


