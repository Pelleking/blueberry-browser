import { ipcMain, WebContents } from "electron";
import type { Window } from "../Window";

async function isOnline(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dns = require("dns");
      let settled = false;
      const done = (result: boolean): void => {
        if (!settled) { settled = true; resolve(result); }
      };
      const timer = setTimeout(() => done(false), 2000);
      dns.resolve("example.com", (err: unknown) => {
        clearTimeout(timer);
        if (err) return done(false);
        done(true);
      });
    } catch { resolve(false); }
  });
}

export function registerSystemEvents(mainWindow: Window): void {
  let networkInterval: NodeJS.Timeout | null = null;
  let lastOnline: boolean | null = null;

  ipcMain.on("dark-mode-changed", (event, isDarkMode) => {
    broadcastDarkMode(mainWindow, event.sender, isDarkMode);
  });

  ipcMain.on("ping", () => console.log("pong"));

  if (!networkInterval) {
    const check = async (): Promise<void> => {
      const online = await isOnline();
      if (lastOnline === null) { lastOnline = online; return; }
      if (!online && lastOnline !== false) {
        const alreadyOffline = mainWindow.sidebar.client.getOfflineMode();
        if (!alreadyOffline) {
          const enabled = await mainWindow.sidebar.client.setOfflineMode(true);
          try { mainWindow.topBar.view.webContents.send("offline-mode-updated", enabled); } catch {}
        }
      }
      lastOnline = online;
    };
    networkInterval = setInterval(check, 5000);
    void check();
  }
}

function broadcastDarkMode(mainWindow: Window, sender: WebContents, isDarkMode: boolean): void {
  if (mainWindow.topBar.view.webContents !== sender) {
    mainWindow.topBar.view.webContents.send("dark-mode-updated", isDarkMode);
  }
  if (mainWindow.sidebar.view.webContents !== sender) {
    mainWindow.sidebar.view.webContents.send("dark-mode-updated", isDarkMode);
  }
  mainWindow.allTabs.forEach((tab) => {
    if (tab.webContents !== sender) {
      tab.webContents.send("dark-mode-updated", isDarkMode);
    }
  });
}


