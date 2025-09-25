import { ipcMain } from "electron";
import type { Window } from "./Window";
import { registerTabsEvents } from "./events/TabsEvents";
import { registerSidebarEvents } from "./events/SidebarEvents";
import { registerPageContentEvents } from "./events/PageContentEvents";
import { registerLLMEvents } from "./events/LLMEvents";
import { registerSystemEvents } from "./events/SystemEvents";

export class EventManager {
  private window: Window;
  private disposeSystemEvents: (() => void) | null = null;

  constructor(window: Window) {
    this.window = window;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    registerTabsEvents(this.window);
    registerSidebarEvents(this.window);
    registerPageContentEvents(this.window);
    registerLLMEvents(this.window);
    this.disposeSystemEvents = registerSystemEvents(this.window);
  }

  public cleanup(): void {
    // Remove all ipcMain handlers for the channels we registered.
    const handles = [
      "create-tab",
      "close-tab",
      "switch-tab",
      "get-tabs",
      "navigate-to",
      "navigate-tab",
      "go-back",
      "go-forward",
      "reload",
      "tab-go-back",
      "tab-go-forward",
      "tab-reload",
      "tab-screenshot",
      "tab-run-js",
      "get-active-tab-info",
      "toggle-sidebar",
      "sidebar-chat-message",
      "sidebar-clear-chat",
      "sidebar-get-messages",
      "open-url-and-summarize",
      "get-page-content",
      "get-page-text",
      "get-current-url",
      "get-offline-mode",
      "set-offline-mode",
      "generate-bridge-qr",
    ];
    for (const ch of handles) {
      try { ipcMain.removeHandler(ch); } catch {}
    }
    if (this.disposeSystemEvents) {
      try { this.disposeSystemEvents(); } catch {}
      this.disposeSystemEvents = null;
    }
  }
}
