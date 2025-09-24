## LLM architecture and module boundaries

This document defines a modular structure for the main-process LLM integration. The goal is to reduce the size and responsibilities of `src/main/LLMClient.ts`, remove duplication across files, and make future changes safer.

### High-level responsibilities (final structure)

- LLMClient (orchestrator):
  - Accepts chat requests from UI/IPC.
  - Coordinates model selection, prompt building, tool usage, and streaming.
  - Emits UI updates and bridge events as needed.
  - Delegates to the modules below; owns almost no domain logic.

- ModelManager:
  - Selects provider (OpenAI/Anthropic/Apple on-device) and model.
  - Handles Apple availability checks and offline-mode switching.
  - Exposes `getModel()`, `getProvider()`, `isOffline()`, `setOfflineMode()`.
  - Location: `src/main/llm/ModelManager.ts` (Apple provider under `llm/providers/AppleOnDevice.ts`).

- PromptBuilder:
  - Builds provider-specific system/context prompts, including page context.
  - Encapsulates constants like max context length and temperatures.
  - Location: `src/main/llm/PromptBuilder.ts`.

- PageInspector:
  - Interacts with the active `Window`/`Tab` to obtain page data.
  - Functions: `getActivePageInfo`, `openUrlAndGetInfo`, `getPageInfoFromTab`, `getScreenshot`.
  - Shares `PageInfo` type and `LINK_SCRAPE_JS` constant with other modules.
  - Location: `src/main/page/PageInspector.ts`.

- Tools:
  - Builds the ai-sdk tools map (`open_url`, `get_page_info`).
  - Uses `PageInspector` and emits minimal bridge events (via a small callback API).
  - Location: `src/main/llm/Tools.ts`.

- MessageStore:
  - A thin wrapper around `CoreMessage[]` with renderer updates and optional bridge mirroring.
  - Streaming helpers: append assistant chunk, finalize message.
  - Location: `src/main/chat/MessageStore.ts`.

- Streamer:
  - Wraps `streamText`, wires tools, pushes chunks to `MessageStore`.
  - Error handling and final fallback if tool produced content but no model text.
  - Location: `src/main/llm/Streamer.ts`.

- Logger (optional):
  - Centralized debug logs and safe truncation/redaction helpers.
  - Location: `src/main/llm/Logger.ts`.

### Shared types and constants

Create `src/main/common/types.ts` with:

```ts
export type PageInfo = {
  title: string | null;
  url: string | null;
  summary: string;
  links: Array<{ text: string; href: string }>;
  status?: number; // optional for compatibility where needed
};

export const LINK_SCRAPE_JS =
  "Array.from(document.querySelectorAll('a[href]')).slice(0,25).map(a => ({ text: (a.textContent||'').trim().slice(0,80), href: a.href }))";
```

Using a shared `PageInfo` and `LINK_SCRAPE_JS` avoids duplicated DOM queries and shapes across modules.

### Data flow overview

1. Renderer sends a chat request → `LLMClient.sendChatMessage()`.
2. `LLMClient` collects context via `PageInspector` and builds prompts via `PromptBuilder`.
3. `LLMClient` builds `tools` using `Tools` with callbacks that:
   - invoke `PageInspector` to open pages or fetch active page info,
   - update `lastToolResult`,
   - forward tool call/result events to `BridgeServer` via `emitEvent`.
4. `Streamer` calls `streamText` with model from `ModelManager`, streams chunks to `MessageStore` which updates renderer and mirrors to bridge.
5. If model returns no text but tool data exists, `Streamer` runs a short follow-up to produce a clear answer.
6. Offline/online switching is handled by `ModelManager`; `LLMClient` broadcasts state changes to the UI/bridge.

### Why this structure

- Separation of concerns: prompts, tools, model, page I/O, streaming, and logging are independent, testable units.
- Reuse: DOM scraping and `PageInfo` are centralized; no duplicated query strings or data shapes.
- Extensibility: adding a provider or tool doesn’t grow `LLMClient`.

### Main-process event modules

To keep `EventManager.ts` small and focused, events are split by domain:

- events/TabsEvents.ts: Tab creation/close/switch, navigation and tab info, run JS, screenshot.
- events/SidebarEvents.ts: Sidebar toggle, chat message routing, clear/get messages, open-url-and-summarize.
- events/PageContentEvents.ts: Get page HTML/text and current URL.
- events/LLMEvents.ts: Offline mode get/set, generate bridge QR (delegates to `bridge/BridgeQr.ts`).
- events/SystemEvents.ts: Dark mode broadcast, network monitoring (auto-enable offline mode), ping.

Helper:
- bridge/BridgeQr.ts: Pure helper for generating the bridge QR (JWT creation + QR encoding) without mutating UI.

Event wiring:
- `EventManager` only calls `register*Events(window)` for each module in `setupEventHandlers()`.

### Incremental refactor plan

1) Introduce `types.ts` and `PageInspector` and refactor `LLMClient` and `BridgeServer` to use them. This removes the biggest duplication (page info and link-scraping).

2) Extract `PromptBuilder` from `LLMClient`:
   - `buildSystemPrompt(url, text, title)`
   - Apple context variant with minimal system prompt and separate context message.

3) Extract `ModelManager` and move provider selection, Apple checks, and offline toggling.

4) Extract `MessageStore` and `Streamer` to trim streaming and message-state code.

5) Extract `Tools` creation and tool-choice nudging logic.

Each step reduces `LLMClient` footprint and isolates change.

### Testing checklist (manual)

- Send a normal chat message (online provider): assistant streams, no errors.
- Toggle offline mode on/off: Apple availability gates, UI updated.
- Ask “what page am I on?”: instant deterministic reply.
- Tool path: ask to open a URL → page opens, assistant summarizes, bridge events emitted.
- “Get page info” tool: ask about current page → summary returned.

### Conventions

- Avoid direct string duplication of DOM scraping code. Use `LINK_SCRAPE_JS`.
- Keep bridge emissions centralized in orchestrator; helpers stay pure where possible.
- Prefer small helpers with explicit inputs/outputs; avoid hidden globals.


