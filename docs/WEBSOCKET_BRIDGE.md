## WebSocket Bridge: Local and Cloud (Cloudflare Tunnel)

This app exposes a lightweight WebSocket bridge so a phone can control and chat with the desktop browser. It works locally on your LAN with no public URL, and can optionally be exposed over the internet using Cloudflare Tunnel.

### What runs where
- **Desktop app (origin server)**: Hosts an HTTP server and a WebSocket endpoint at `/bridge` on `BRIDGE_PORT` (default `4939`).
- **Mobile app (client)**: Connects to the bridge and sends commands/chats. It uses a QR code to receive connection details and a signed token.

### Endpoint and auth
- **Endpoint**: `ws://<host>:<port>/bridge` for LAN, or `wss://<domain>/bridge` when tunneled.
- **Auth**: JWT passed in the `Sec-WebSocket-Protocol` header as `blueberry, v1, <token>`.
- **Token TTL**: Controlled by `BRIDGE_TOKEN_TTL_SEC` (default 300s). Short-lived by design.

### QR payload format
The QR encodes a small JSON object that the phone scans:

```json
{
  "url": "ws://192.168.1.12:4939/bridge",
  "proto": "blueberry,v1,<jwt>"
}
```

- When `BRIDGE_PUBLIC_URL` is set, `url` becomes the public `wss://.../bridge` instead of the LAN URL.
- The `proto` string must be sent back in the `Sec-WebSocket-Protocol` header by the client.

## Using it locally (no public URL)
This is the simplest setup and requires that both devices are on the same network.

1) Start the desktop app. The bridge listens on `BRIDGE_PORT` (default `4939`).
2) Click “Generate Bridge QR” in the UI.
3) The QR contains `ws://<your-lan-ip>:4939/bridge` plus a short-lived token.
4) Scan with the phone app while both devices are on the same Wi‑Fi/LAN.

Tips:
- Ensure the desktop firewall allows inbound connections on the chosen port.
- If multiple interfaces exist, the app picks the first IPv4 non-internal address it finds.
- Regenerate the QR if you wait past token expiry.

## Exposing it publicly with Cloudflare Tunnel (optional)
Use this when the phone is off-LAN (e.g., on 4G). You’ll get a stable `wss://` URL that forwards to your local port.

1) Install and set up Cloudflare Tunnel on the desktop:
```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create blueberry-bridge
cloudflared tunnel route dns blueberry-bridge bridge.example.com
```

2) Configure the tunnel to forward to the local bridge:
```yaml
tunnel: blueberry-bridge
credentials-file: /usr/local/etc/cloudflared/<UUID>.json
ingress:
  - hostname: bridge.example.com
    service: http://localhost:4939
  - service: http_status:404
```

3) Run the tunnel:
```bash
cloudflared tunnel run blueberry-bridge
```

4) Tell the app to use the public URL:
```bash
# .env
BRIDGE_PUBLIC_URL=wss://bridge.example.com
BRIDGE_PORT=4939
BRIDGE_PING_SEC=30
BRIDGE_TOKEN_TTL_SEC=3600
BRIDGE_JWT_SECRET=your-long-random-secret
```

5) Restart the desktop app and “Generate Bridge QR” again. The QR now carries `wss://bridge.example.com/bridge` so the phone can connect from anywhere.

Quick test (no DNS):
```bash
cloudflared tunnel --url http://localhost:4939
```
Use the printed `https://*.trycloudflare.com` address as `BRIDGE_PUBLIC_URL` (replace `https://` with `wss://`).

## Reliability: keepalive and reconnection
- The server sends periodic WebSocket pings (`BRIDGE_PING_SEC`, default 30s) to prevent idle timeouts at proxies/Cloudflare and to detect dead connections.
- Mobile client should implement reconnect with backoff and retry when switching networks (Wi‑Fi ↔ 4G).
- Tokens are short-lived; if the client reconnects after expiry, re-scan the QR or request a fresh token.

## Environment variables
- **BRIDGE_PORT**: Local server port for the bridge (default `4939`).
- **BRIDGE_JWT_SECRET**: Secret for signing/verifying JWTs. Set a long random string in production.
- **BRIDGE_PUBLIC_URL**: Optional `wss://host` used in QR payload for public access.
- **BRIDGE_PING_SEC**: Heartbeat interval in seconds for server-initiated pings (default `30`).
- **BRIDGE_TOKEN_TTL_SEC**: Token lifetime in seconds (default `300`).

## Troubleshooting
- Can’t connect on LAN: verify both devices are on the same subnet; open firewall for `BRIDGE_PORT`.
- 401/4001 unauthorized close: token expired or `BRIDGE_JWT_SECRET` mismatch.
- Drops after a while: ensure keepalive is enabled (`BRIDGE_PING_SEC`), and that Cloudflare Tunnel is running.
- Public URL connects but no messages: confirm `Sec-WebSocket-Protocol` includes `blueberry, v1, <token>`.
- Time skew: if system clocks are far off, JWT `nbf/exp` can fail.

## Files of interest
- `src/main/BridgeServer.ts` — WebSocket server and heartbeat.
- `src/main/EventManager.ts` — Generates QR payload; uses `BRIDGE_PUBLIC_URL` when provided.

