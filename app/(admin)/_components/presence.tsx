"use client";

/**
 * Client presence layer — live cursors + avatar stack over the
 * self-hosted WS sidecar (see realtime/ws-server.mjs, proxied at /ws).
 *
 * Designed to be DORMANT-SAFE: if the /ws endpoint isn't live yet (sidecar
 * not started), the socket just fails to connect and everything no-ops —
 * no errors surface to the user. So this can ship before the ops wiring.
 *
 * Cursors use document coordinates (pageX/pageY) so a peer's cursor lands
 * on the same content for everyone, and we translate by scroll offset at
 * render time so it tracks while scrolling.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface Peer {
  connId: string;
  staffId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

interface PresenceState {
  peers: Peer[];
  connected: boolean;
}

function wsUrl(room: string): string | null {
  if (typeof window === "undefined") return null;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?room=${encodeURIComponent(room)}`;
}

/**
 * Open a presence connection for `room`, broadcasting this user's cursor
 * and tracking peers. `name` is the current user's display name (cosmetic;
 * staffId is server-authoritative). Returns peers + a connected flag.
 */
export function usePresence(room: string, name: string): PresenceState {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const lastSentRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  const sync = useCallback(() => {
    setPeers(Array.from(peersRef.current.values()));
  }, []);

  useEffect(() => {
    closedRef.current = false;
    let attempt = 0;

    function connect() {
      const url = wsUrl(room);
      if (!url) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        return; // dormant-safe: sidecar not up yet
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        ws.send(JSON.stringify({ t: "hello", name }));
      };

      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (msg.t) {
          case "welcome": {
            peersRef.current.clear();
            for (const p of (msg.peers as Peer[]) ?? []) peersRef.current.set(p.connId, p);
            sync();
            break;
          }
          case "join": {
            const p = msg.peer as Peer;
            if (p) peersRef.current.set(p.connId, p);
            sync();
            break;
          }
          case "leave": {
            peersRef.current.delete(msg.connId as string);
            sync();
            break;
          }
          case "cursor": {
            const p = peersRef.current.get(msg.connId as string);
            if (p) {
              p.x = msg.x as number;
              p.y = msg.y as number;
              sync();
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        peersRef.current.clear();
        sync();
        if (closedRef.current) return;
        // Reconnect with capped backoff (also covers "sidecar not live yet").
        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        reconnectRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };
    }

    connect();

    function onMove(e: MouseEvent) {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const now = performance.now();
      if (now - lastSentRef.current < 45) return; // ~22fps throttle
      lastSentRef.current = now;
      ws.send(JSON.stringify({ t: "cursor", x: Math.round(e.pageX), y: Math.round(e.pageY) }));
    }
    window.addEventListener("mousemove", onMove, { passive: true });

    return () => {
      closedRef.current = true;
      window.removeEventListener("mousemove", onMove);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      try {
        wsRef.current?.close();
      } catch {}
    };
  }, [room, name, sync]);

  return { peers, connected };
}

/** Floating labelled cursors for every peer in the room. */
export function PresenceCursors({ peers }: { peers: Peer[] }) {
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const onScroll = () => setScroll({ x: window.scrollX, y: window.scrollY });
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      {peers.map((p) =>
        p.x < 0 ? null : (
          <div
            key={p.connId}
            className="absolute transition-transform duration-75 ease-linear"
            style={{ transform: `translate(${p.x - scroll.x}px, ${p.y - scroll.y}px)` }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <title>{p.name} cursor</title>
              <path
                d="M2 2l5.5 13 2.2-5.3L15 7.5 2 2z"
                fill={p.color}
                stroke="white"
                strokeWidth="1"
              />
            </svg>
            <span
              className="ml-2 inline-block whitespace-nowrap rounded px-1.5 py-0.5 font-medium text-[10px] text-white"
              style={{ backgroundColor: p.color }}
            >
              {p.name}
            </span>
          </div>
        ),
      )}
    </div>
  );
}

/** Compact avatar stack showing who else is here. */
export function PresenceAvatars({ peers }: { peers: Peer[] }) {
  // Dedupe by staffId — same person in two tabs shows once.
  const byStaff = new Map<string, Peer>();
  for (const p of peers) if (!byStaff.has(p.staffId)) byStaff.set(p.staffId, p);
  const unique = Array.from(byStaff.values());
  if (unique.length === 0) return null;

  const initials = (n: string) =>
    n
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="flex items-center gap-1.5" title={`${unique.length} here now`}>
      <div className="-space-x-2 flex">
        {unique.slice(0, 5).map((p) => (
          <span
            key={p.staffId}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white font-semibold text-[9px] text-white ring-0 dark:border-zinc-900"
            style={{ backgroundColor: p.color }}
            title={p.name}
          >
            {initials(p.name)}
          </span>
        ))}
      </div>
      {unique.length > 5 && (
        <span className="font-mono text-[10px] text-zinc-500">+{unique.length - 5}</span>
      )}
      <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-widest">here</span>
    </div>
  );
}

const MEETING_MODE_KEY = "perse:meeting-mode";
const MEETING_MODE_EVENT = "perse:meeting-mode-change";

/**
 * Global "meeting mode" flag, persisted to localStorage and synced across
 * components and tabs. When ON, live cursors are shown; when OFF they are
 * hidden everywhere. The dashboard toggle writes it; presence layers read it.
 */
export function useMeetingMode(): [boolean, (on: boolean) => void] {
  const [on, setOnState] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        setOnState(window.localStorage.getItem(MEETING_MODE_KEY) === "1");
      } catch {
        /* localStorage unavailable — stay off */
      }
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener(MEETING_MODE_EVENT, read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener(MEETING_MODE_EVENT, read);
    };
  }, []);

  const setOn = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(MEETING_MODE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    setOnState(next);
    // storage events only fire in OTHER tabs; notify this tab explicitly.
    window.dispatchEvent(new Event(MEETING_MODE_EVENT));
  }, []);

  return [on, setOn];
}
