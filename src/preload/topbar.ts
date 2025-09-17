import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// TopBar specific APIs
const topBarAPI = {
  // Tab management
  createTab: (url?: string) =>
    electronAPI.ipcRenderer.invoke("create-tab", url),
  closeTab: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("close-tab", tabId),
  switchTab: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("switch-tab", tabId),
  getTabs: () => electronAPI.ipcRenderer.invoke("get-tabs"),

  // Tab navigation
  navigateTab: (tabId: string, url: string) =>
    electronAPI.ipcRenderer.invoke("navigate-tab", tabId, url),
  goBack: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("tab-go-back", tabId),
  goForward: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("tab-go-forward", tabId),
  reload: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("tab-reload", tabId),

  // Tab actions
  tabScreenshot: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("tab-screenshot", tabId),
  tabRunJs: (tabId: string, code: string) =>
    electronAPI.ipcRenderer.invoke("tab-run-js", tabId, code),

  // Sidebar
  toggleSidebar: () =>
    electronAPI.ipcRenderer.invoke("toggle-sidebar"),

  // LLM offline mode
  getOfflineMode: () => electronAPI.ipcRenderer.invoke("get-offline-mode"),
  setOfflineMode: (enabled: boolean) =>
    electronAPI.ipcRenderer.invoke("set-offline-mode", enabled),
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("topBarAPI", topBarAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.topBarAPI = topBarAPI;
}

