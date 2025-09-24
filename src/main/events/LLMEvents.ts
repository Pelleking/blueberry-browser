import { ipcMain } from "electron";
import type { Window } from "../Window";
import { createBridgeQrDataUrl } from "../bridge/BridgeQr";

export function registerLLMEvents(mainWindow: Window): void {
  ipcMain.handle("get-offline-mode", () => {
    return mainWindow.sidebar.client.getOfflineMode();
  });

  ipcMain.handle("set-offline-mode", async (_evt, enabled: boolean) => {
    const result = await mainWindow.sidebar.client.setOfflineMode(enabled);
    if (enabled && !result) {
      const reason = mainWindow.sidebar.client.getAppleUnavailableReason();
      const suffix = reason ? ` (Reason: ${reason})` : "";
      mainWindow.sidebar.client.addAssistantMessage(
        `OOh I see what you are trying to do here Pelle but your mac is not up to spec for that hehe${suffix}`
      );
    }
    try { mainWindow.topBar.view.webContents.send("offline-mode-updated", mainWindow.sidebar.client.getOfflineMode()); } catch {}
    return result;
  });

  ipcMain.handle("generate-bridge-qr", async () => {
    const qr = await createBridgeQrDataUrl();
    if (qr.ok && qr.dataUrl) {
      mainWindow.sidebar.client.addAssistantMessage(
        [
          "Scan this QR code with the Blueberry mobile app (expires in 5 minutes):",
          "",
          `![](${qr.dataUrl})`,
        ].join("\n")
      );
      return { ok: true };
    }
    return { ok: false };
  });
}


