import os from "os";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";

function getLocalIpAddress(): string {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      const list = ifaces[name] || [];
      for (const iface of list) {
        if (!iface || iface.internal) continue;
        if (iface.family === "IPv4" && iface.address) return iface.address;
      }
    }
  } catch {
    // ignore
  }
  return "127.0.0.1";
}

export async function createBridgeQrDataUrl(): Promise<{ ok: boolean; dataUrl?: string }> {
  try {
    const publicUrl = process.env.BRIDGE_PUBLIC_URL;
    const port = Number(process.env.BRIDGE_PORT || 4939);
    const ip = getLocalIpAddress();
    const url = publicUrl && publicUrl.trim() ? `${publicUrl.replace(/\/$/, "")}/bridge` : `ws://${ip}:${port}/bridge`;
    const secret = process.env.BRIDGE_JWT_SECRET || "dev-secret";
    const now = Math.floor(Date.now() / 1000);
    const ttlSec = Number(process.env.BRIDGE_TOKEN_TTL_SEC || 300);
    const token = jwt.sign(
      { sub: "blueberry-mobile", iat: now, nbf: now, exp: now + (ttlSec > 0 ? ttlSec : 300) },
      secret
    );
    const proto = `blueberry,v1,${token}`;
    const payload = { url, proto };
    const text = JSON.stringify(payload);
    const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: "M", scale: 6 });
    return { ok: true, dataUrl };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Failed to create bridge QR:", e);
    return { ok: false };
  }
}


