import { ipcMain } from "electron";
import type { Window } from "../Window";

export function registerPageContentEvents(mainWindow: Window): void {
  ipcMain.handle("get-page-content", async () => {
    if (mainWindow.activeTab) {
      try { return await mainWindow.activeTab.getTabHtml(); } catch (e) { console.error("Error getting page content:", e); return null; }
    }
    return null;
  });

  ipcMain.handle("get-page-text", async () => {
    if (mainWindow.activeTab) {
      try { return await mainWindow.activeTab.getTabText(); } catch (e) { console.error("Error getting page text:", e); return null; }
    }
    return null;
  });

  ipcMain.handle("get-current-url", () => {
    return mainWindow.activeTab ? mainWindow.activeTab.url : null;
  });
}


