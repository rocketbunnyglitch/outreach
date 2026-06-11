"use client";

import { cn } from "@/lib/cn";
import { Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface PresentUser {
  staffId: string;
  displayName: string;
  route: string;
  label: string;
  at: string;
  lastActiveAt: string;
}

const IDLE_MS = 10 * 60 * 1000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || "?";
}

/**
 * Live "who's online" widget. Polls /api/presence/all every 20s; greys teammates
 * who've had the app open but idle for >10 min; click an avatar to see (and jump
 * to) the entry/tab they're on.
 *
 * Two render modes:
 *   - default (compact={false}): full card with header + wrapped pills (legacy
 *     placement under the KPI strip)
 *   - compact={true}: a small pill sized to sit beside MeetingMode in the
 *     dashboard's top-right. Shows a pulse dot, the count, and stacked
 *     avatars; clicking it opens a popover with the full list.
 */
export function WhosOnline({
  currentStaffId,
  compact = false,
}: {
  currentStaffId: string;
  compact?: boolean;
}) {
  const [present, setPresent] = useState<PresentUser[]>([]);
  // Start `now` at 0 so server SSR + client first-render produce the
  // SAME idle calculations (idle = now - lastActiveAt > IDLE_MS is
  // always false when now === 0). The real timestamp gets set on
  // mount, after hydration, so the first paint stays consistent
  // between server and client.
  //
  // Previously this was `useState(() => Date.now())` which ran on the
  // server at T1 and again on the client at T2 (typically 50-500ms
  // later). When any viewer's `lastActiveAt` sat near the IDLE_MS
  // threshold, the idle flag flipped between the two renders → the
  // dot's className / opacity differed → React's hydration check
  // threw the minified #418 ("Text content does not match server-
  // rendered HTML") and tore down the tree. That broke the entire
  // dashboard load for any browser profile where some viewer happened
  // to be near the threshold at request time — explaining why the
  // app worked in incognito (no stale presence data) but not in the
  // regular profile.
  const [now, setNow] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Set the real timestamp on mount — see the useState comment above
    // for why this isn't the initial value.
    setNow(Date.now());
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/presence/all", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { present: PresentUser[] };
        if (alive) setPresent(data.present ?? []);
      } catch {
        // transient — next tick recovers
      }
    }
    poll();
    const poller = setInterval(poll, 20_000);
    const ticker = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(poller);
      clearInterval(ticker);
    };
  }, []);

  // Outside-click + Escape for the compact popover.
  useEffect(() => {
    if (!popoverOpen) return;
    function onPointer(e: PointerEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  if (present.length === 0) return null;

  // ---------------------------------------------------------------------
  // Compact pill — sized to match MeetingMode in the dashboard header
  // ---------------------------------------------------------------------
  if (compact) {
    const visible = present.slice(0, 3);
    const extra = Math.max(0, present.length - visible.length);
    return (
      <div ref={popoverRef} className="relative">
        <button
          type="button"
          onClick={() => setPopoverOpen((o) => !o)}
          aria-expanded={popoverOpen}
          aria-haspopup="menu"
          title={`${present.length} online`}
          className={cn(
            "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
            "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900",
          )}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="tabular-nums">{present.length}</span>
          <span className="hidden sm:inline">Online</span>
          {/* Stacked avatar mini-strip. Hidden on phones to keep the pill
              compact next to MeetingMode. */}
          <span className="-space-x-1.5 hidden items-center md:flex">
            {visible.map((u) => {
              const idle = now - new Date(u.lastActiveAt).getTime() > IDLE_MS;
              return (
                <span
                  key={u.staffId}
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border-2 font-mono text-[8px] text-white",
                    idle ? "bg-zinc-400 dark:bg-zinc-600" : "bg-emerald-600",
                    "border-zinc-50 dark:border-zinc-950",
                  )}
                >
                  {initials(u.displayName)}
                </span>
              );
            })}
            {extra > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-zinc-50 bg-zinc-300 px-1 font-mono text-[8px] text-zinc-700 dark:border-zinc-950 dark:bg-zinc-700 dark:text-zinc-200">
                +{extra}
              </span>
            )}
          </span>
        </button>
        {popoverOpen && (
          // Anchor: left-0 (opens RIGHTWARD) on mobile where the pill sits at
          // the left edge of its row — right-0 there pushed the 256px panel
          // off the left side of the screen (operator report 2026-06-11).
          // sm+ keeps right-0 since the pill lives near the page's right.
          <div className="card-surface absolute top-full left-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] p-3 sm:right-0 sm:left-auto">
            <div className="mb-2 flex items-center gap-1.5">
              <Users className="h-3 w-3 text-zinc-400" />
              <h3 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                Online · {present.length}
              </h3>
            </div>
            <ul className="flex flex-col gap-1.5">
              {present.map((u) => {
                const idle = now - new Date(u.lastActiveAt).getTime() > IDLE_MS;
                const isSelf = u.staffId === currentStaffId;
                return (
                  <li key={u.staffId}>
                    <Link
                      href={u.route}
                      onClick={() => setPopoverOpen(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40",
                        idle && "opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] text-white",
                          idle ? "bg-zinc-400 dark:bg-zinc-600" : "bg-emerald-600",
                        )}
                      >
                        {initials(u.displayName)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-xs text-zinc-900 dark:text-zinc-100">
                          {u.displayName}
                          {isSelf && <span className="ml-1 text-[10px] text-zinc-500">(you)</span>}
                        </span>
                        <span className="truncate font-mono text-[10px] text-zinc-500">
                          {idle ? "idle 10m+ · " : ""}
                          {u.label}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Default — original full-card variant
  // ---------------------------------------------------------------------
  return (
    <section className="card-surface rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <h2 className="font-mono text-[11px] text-zinc-600 uppercase tracking-[0.14em] dark:text-zinc-400">
          Who&apos;s online
        </h2>
        <span className="font-mono text-[10px] text-zinc-400 tabular-nums">{present.length}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {present.map((u) => {
          const idle = now - new Date(u.lastActiveAt).getTime() > IDLE_MS;
          const isSelf = u.staffId === currentStaffId;
          const open = openId === u.staffId;
          return (
            <div key={u.staffId} className="relative">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : u.staffId)}
                title={`${u.displayName}${isSelf ? " (you)" : ""} · ${u.label}${idle ? " · idle 10m+" : " · active"}`}
                className={cn(
                  "flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 transition-colors",
                  "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900",
                  idle && "opacity-45",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] text-white",
                    idle ? "bg-zinc-400 dark:bg-zinc-600" : "bg-emerald-600",
                  )}
                >
                  {initials(u.displayName)}
                </span>
                <span className="text-xs text-zinc-700 dark:text-zinc-300">
                  {u.displayName.split(" ")[0]}
                  {isSelf ? " (you)" : ""}
                </span>
              </button>
              {open ? (
                <div className="absolute top-full left-0 z-10 mt-1 w-48 rounded-lg border border-zinc-200 bg-white p-2 text-xs shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{u.displayName}</p>
                  <p className="mt-0.5 text-zinc-500">{idle ? "Idle 10m+ on:" : "Active on:"}</p>
                  <Link
                    href={u.route}
                    className="mt-1 block truncate font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                    onClick={() => setOpenId(null)}
                  >
                    {u.label} →
                  </Link>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
