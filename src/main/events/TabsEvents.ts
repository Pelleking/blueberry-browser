import { ipcMain } from "electron";
import type { Window } from "../Window";

export function registerTabsEvents(mainWindow: Window): void {
  ipcMain.handle("create-tab", (_, url?: string) => {
    const newTab = mainWindow.createTab(url);
    return { id: newTab.id, title: newTab.title, url: newTab.url };
  });

  ipcMain.handle("close-tab", (_, id: string) => {
    mainWindow.closeTab(id);
  });

  ipcMain.handle("switch-tab", (_, id: string) => {
    mainWindow.switchActiveTab(id);
  });

  ipcMain.handle("get-tabs", () => {
    const activeTabId = mainWindow.activeTab?.id;
    return mainWindow.allTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      isActive: activeTabId === tab.id,
    }));
  });

  ipcMain.handle("navigate-to", (_, url: string) => {
    if (mainWindow.activeTab) {
      mainWindow.activeTab.loadURL(url);
    }
  });

  ipcMain.handle("navigate-tab", async (_, tabId: string, url: string) => {
    const tab = mainWindow.getTab(tabId);
    if (tab) {
      await tab.loadURL(url);
      return true;
    }
    return false;
  });

  ipcMain.handle("go-back", () => {
    mainWindow.activeTab?.goBack();
  });

  ipcMain.handle("go-forward", () => {
    mainWindow.activeTab?.goForward();
  });

  ipcMain.handle("reload", () => {
    mainWindow.activeTab?.reload();
  });

  ipcMain.handle("tab-go-back", (_, tabId: string) => {
    const tab = mainWindow.getTab(tabId);
    if (tab) { tab.goBack(); return true; }
    return false;
  });

  ipcMain.handle("tab-go-forward", (_, tabId: string) => {
    const tab = mainWindow.getTab(tabId);
    if (tab) { tab.goForward(); return true; }
    return false;
  });

  ipcMain.handle("tab-reload", (_, tabId: string) => {
    const tab = mainWindow.getTab(tabId);
    if (tab) { tab.reload(); return true; }
    return false;
  });

  ipcMain.handle("tab-screenshot", async (_, tabId: string) => {
    const tab = mainWindow.getTab(tabId);
    if (tab) { const image = await tab.screenshot(); return image.toDataURL(); }
    return null;
  });

  ipcMain.handle("tab-run-js", async (_, tabId: string, code: string) => {
    const tab = mainWindow.getTab(tabId);
    if (tab) { return await tab.runJs(code); }
    return null;
  });

  ipcMain.handle("get-active-tab-info", () => {
    const activeTab = mainWindow.activeTab;
    if (activeTab) {
      return {
        id: activeTab.id,
        url: activeTab.url,
        title: activeTab.title,
        canGoBack: activeTab.webContents.canGoBack(),
        canGoForward: activeTab.webContents.canGoForward(),
      };
    }
    return null;
  });
}


