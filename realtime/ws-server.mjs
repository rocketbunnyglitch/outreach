// @ts-nocheck
/**
 * Self-hosted WebSocket presence server (the "feels like Google Sheets"
 * layer — live cursors + avatars). Runs as its OWN process (PM2 app
 * "outreach-ws"), separate from the Next app, behind nginx at /ws.
 *
 *   browser ──wss://host/ws?room=...──▶ nginx (TLS) ──▶ 127.0.0.1:WS_PORT
 *
 * Why a sidecar: `next start` (standalone) doesn't expose its HTTP
 * server for a WS upgrade handler, and a separate process restarts
 * independently and keeps the app build clean.
 *
 * Auth: every socket must carry a valid Auth.js (NextAuth v5) session
 * cookie. We decode it with the SAME NEXTAUTH_SECRET the app uses, so
 * only logged-in staff get presence. staffId from the token is
 * authoritative; display name + colour are cosmetic (client-supplied).
 *
 * State: in-memory only (rooms → peers). Perfect for the single app
 * instance. If we ever scale horizontally we'd add Redis pub/sub.
 *
 * Protocol (JSON frames):
 *   server→client:  {t:"welcome", you, peers:[...]}
 *                   {t:"join", peer}
 *                   {t:"leave", connId}
 *                   {t:"cursor", connId, x, y}
 *                   {t:"edit", connId, field}        (phase 2 hook)
 *   client→server:  {t:"hello", name, color}
 *                   {t:"cursor", x, y}
 *                   {t:"edit", field}
 */

import { createServer } from "node:http";
import { decode } from "@auth/core/jwt";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.WS_PORT ?? 3002);
const HOST = process.env.WS_HOST ?? "127.0.0.1";
const SECRET = process.env.NEXTAUTH_SECRET;
const HEARTBEAT_MS = 30_000;

if (!SECRET) {
  console.error("[ws] NEXTAUTH_SECRET is not set — cannot verify sessions. Exiting.");
  process.exit(1);
}

// Auth.js v5 cookie names (https → __Secure- prefix). The cookie name
// doubles as the HKDF salt for decode, so we must pair them correctly.
const COOKIE_CANDIDATES = ["__Secure-authjs.session-token", "authjs.session-token"];

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

async function authenticate(req) {
  const cookies = parseCookies(req.headers.cookie);
  for (const name of COOKIE_CANDIDATES) {
    const token = cookies[name];
    if (!token) continue;
    try {
      const payload = await decode({ token, secret: SECRET, salt: name });
      if (payload?.staffId) return { staffId: String(payload.staffId) };
    } catch {
      // try the next candidate / fall through to reject
    }
  }
  return null;
}

/** Deterministic pleasant colour from a staffId (stable per user). */
function colorFor(staffId) {
  let h = 0;
  for (let i = 0; i < staffId.length; i++) h = (h * 31 + staffId.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 55%)`;
}

// roomId -> Map<connId, peer>
const rooms = new Map();
let connSeq = 0;

function roomPeers(roomId) {
  let m = rooms.get(roomId);
  if (!m) {
    m = new Map();
    rooms.set(roomId, m);
  }
  return m;
}

function publicPeer(p) {
  return { connId: p.connId, staffId: p.staffId, name: p.name, color: p.color, x: p.x, y: p.y };
}

function broadcast(roomId, msg, exceptConnId) {
  const peers = rooms.get(roomId);
  if (!peers) return;
  const data = JSON.stringify(msg);
  for (const p of peers.values()) {
    if (p.connId === exceptConnId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

const httpServer = createServer((req, res) => {
  // Lightweight health endpoint for PM2/curl checks.
  if (req.url === "/health" || req.url === "/ws/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(426, { "content-type": "text/plain" });
  res.end("Upgrade Required");
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", async (req, socket, head) => {
  try {
    const auth = await authenticate(req);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const url = new URL(req.url, "http://localhost");
    const roomId = (url.searchParams.get("room") || "").slice(0, 200);
    if (!roomId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, auth.staffId, roomId);
    });
  } catch (err) {
    console.error("[ws] upgrade error", err);
    try {
      socket.destroy();
    } catch {}
  }
});

function onConnection(ws, staffId, roomId) {
  const connId = `c${++connSeq}`;
  const peer = {
    connId,
    staffId,
    name: "Someone",
    color: colorFor(staffId),
    x: -1,
    y: -1,
    ws,
    alive: true,
    roomId,
  };
  const peers = roomPeers(roomId);
  peers.set(connId, peer);

  // Tell the newcomer who it is + who's already here.
  ws.send(
    JSON.stringify({
      t: "welcome",
      you: { connId, staffId, color: peer.color },
      peers: Array.from(peers.values())
        .filter((p) => p.connId !== connId)
        .map(publicPeer),
    }),
  );

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === "hello") {
      if (typeof msg.name === "string") peer.name = msg.name.slice(0, 60);
      if (typeof msg.color === "string" && /^[a-z0-9 ()%,.#-]{1,40}$/i.test(msg.color)) {
        peer.color = msg.color;
      }
      broadcast(roomId, { t: "join", peer: publicPeer(peer) }, connId);
    } else if (msg.t === "cursor") {
      peer.x = Number(msg.x) || 0;
      peer.y = Number(msg.y) || 0;
      broadcast(roomId, { t: "cursor", connId, x: peer.x, y: peer.y }, connId);
    } else if (msg.t === "edit") {
      // Phase 2 hook: someone is editing a field; relay so others can
      // show a highlight / "refresh to see changes" nudge.
      broadcast(
        roomId,
        { t: "edit", connId, field: String(msg.field ?? "").slice(0, 120) },
        connId,
      );
    }
  });

  ws.on("pong", () => {
    peer.alive = true;
  });

  const cleanup = () => {
    peers.delete(connId);
    if (peers.size === 0) rooms.delete(roomId);
    broadcast(roomId, { t: "leave", connId }, connId);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

// Heartbeat: drop sockets that stop responding (closed laptops, etc).
const heartbeat = setInterval(() => {
  for (const peers of rooms.values()) {
    for (const p of peers.values()) {
      if (!p.alive) {
        try {
          p.ws.terminate();
        } catch {}
        continue;
      }
      p.alive = false;
      try {
        p.ws.ping();
      } catch {}
    }
  }
}, HEARTBEAT_MS);

httpServer.listen(PORT, HOST, () => {});

function shutdown() {
  clearInterval(heartbeat);
  for (const peers of rooms.values()) {
    for (const p of peers.values()) {
      try {
        p.ws.close();
      } catch {}
    }
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
