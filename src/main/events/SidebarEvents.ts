import { ipcMain } from "electron";
import type { Window } from "../Window";

export function registerSidebarEvents(mainWindow: Window): void {
  ipcMain.handle("toggle-sidebar", () => {
    mainWindow.sidebar.toggle();
    mainWindow.updateAllBounds();
    return true;
  });

  ipcMain.handle("sidebar-chat-message", async (_, request) => {
    await mainWindow.sidebar.client.sendChatMessage(request);
  });

  ipcMain.handle("sidebar-clear-chat", () => {
    mainWindow.sidebar.client.clearMessages();
    return true;
  });

  ipcMain.handle("sidebar-get-messages", () => {
    return mainWindow.sidebar.client.getMessages();
  });

  ipcMain.handle("open-url-and-summarize", async (_evt, url: string) => {
    await mainWindow.sidebar.client.openUrlAndSummarize(url);
    return true;
  });
}


