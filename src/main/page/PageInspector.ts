import type { Window } from "../Window";
import type { Tab } from "../Tab";
import type { PageInfo } from "../common/types";
import { LINK_SCRAPE_JS } from "../common/types";

export class PageInspector {
  private readonly window: Window;

  constructor(window: Window) {
    this.window = window;
  }

  async getActivePageInfo(): Promise<PageInfo> {
    const active = this.window?.activeTab;
    if (!active) return { title: null, url: null, summary: "", links: [] };
    return await this.getInfoForTab(active);
  }

  async openUrlAndGetInfo(url: string): Promise<PageInfo & { url: string }> {
    const tab = this.window.createTab(url);
    this.window.switchActiveTab(tab.id);
    try { await tab.loadURL(url); } catch {}
    const info = await this.getInfoForTab(tab);
    return { ...info, url };
  }

  async getScreenshotDataUrl(): Promise<string | null> {
    const active = this.window?.activeTab;
    if (!active) return null;
    try {
      const image = await active.screenshot();
      return image.toDataURL();
    } catch {
      return null;
    }
  }

  async getInfoForTab(tab: Tab): Promise<PageInfo> {
    const title = tab.title || null;
    const url = tab.url || null;
    let summary = "";
    try {
      const text = await tab.getTabText();
      summary = (text || "").split(/\s+/).slice(0, 200).join(" ");
    } catch {}
    let links: Array<{ text: string; href: string }> = [];
    try {
      links = await tab.runJs(LINK_SCRAPE_JS);
    } catch {}
    return { title, url, summary, links };
  }
}


