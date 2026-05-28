"use client";

import { cn } from "@/lib/cn";
import Link from "next/link";
import { useEffect, useState } from "react";

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
 * Live "who's online" strip. Polls /api/presence/all every 20s; greys teammates
 * who've had the app open but idle for >10 min; click an avatar to see (and jump
 * to) the entry/tab they're on.
 */
export function WhosOnline({ currentStaffId }: { currentStaffId: string }) {
  const [present, setPresent] = useState<PresentUser[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
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

  if (present.length === 0) return null;

  return (
    <section className="rounded-2xl card-surface p-4">
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
