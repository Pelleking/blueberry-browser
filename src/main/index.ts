import { app, BrowserWindow } from "electron";
import { electronApp } from "@electron-toolkit/utils";
import { Window } from "./Window";
import { AppMenu } from "./Menu";
import { EventManager } from "./EventManager";
import { BridgeServer } from "./BridgeServer";

// Force Chromium/Electron UI locale to en-US before app initialization
try {
  app.commandLine.appendSwitch("lang", "en-US");
} catch {}

let mainWindow: Window | null = null;
let eventManager: EventManager | null = null;
let menu: AppMenu | null = null;
let bridge: BridgeServer | null = null;

const createWindow = (): Window => {
  const window = new Window();
  menu = new AppMenu(window);
  eventManager = new EventManager(window);
  // Start bridge server and connect to LLM client
  try {
    bridge = new BridgeServer(window, window.sidebar.client);
    window.sidebar.client.setBridgeEmitter(bridge);
    bridge.start();
  } catch (e) {
    console.error("Failed to start bridge:", e);
  }
  return window;
};

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.electron");

  mainWindow = createWindow();

  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (eventManager) {
    eventManager.cleanup();
    eventManager = null;
  }

  if (bridge) {
    try { bridge.stop(); } catch {}
    bridge = null;
  }

  // Clean up references
  if (mainWindow) {
    mainWindow = null;
  }
  if (menu) {
    menu = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
