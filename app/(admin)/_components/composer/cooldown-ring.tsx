"use client";

/**
 * Cold-send cooldown ring (migration 0106). Renders next to the From inbox's
 * daily cap counter while a cold-send pacing cooldown is active. The ring
 * depletes as the window elapses and color-shifts from red (just started) to
 * green (about to unlock); the remaining whole MINUTES show small in the
 * center. Renders nothing when there's no active cooldown.
 *
 * Clock reads happen only after mount (in an effect) so there's no SSR/hydration
 * wall-clock mismatch; the component renders null until mounted.
 */

import { useEffect, useState } from "react";

// Full-scale for the ring fill + color ramp (the max possible cooldown).
const MAX_MS = 8 * 60_000;

export function CooldownRing({ until }: { until: string | null }) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (!until) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);

  if (!until || nowMs === null) return null;
  const end = Date.parse(until);
  const remaining = end - nowMs;
  if (!Number.isFinite(end) || remaining <= 0) return null;

  const frac = Math.min(1, remaining / MAX_MS); // 1 = full window, 0 = unlocked
  const hue = Math.round((1 - frac) * 120); // 0 (red) -> 120 (green)
  const color = `hsl(${hue} 80% 45%)`;
  const minutes = Math.ceil(remaining / 60_000);

  const r = 9;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - frac);

  return (
    <span
      title={`Cold-send cooldown: about ${minutes} min left`}
      className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center"
      aria-label={`Cold-send cooldown, about ${minutes} minutes left`}
    >
      <svg viewBox="0 0 24 24" className="-rotate-90 h-6 w-6">
        <title>Cold-send cooldown, about {minutes} min left</title>
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          strokeWidth="2.5"
          className="stroke-zinc-200 dark:stroke-zinc-700"
        />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s linear, stroke 1s linear" }}
        />
      </svg>
      <span className="absolute font-mono text-[8px] text-zinc-600 tabular-nums dark:text-zinc-300">
        {minutes}
      </span>
    </span>
  );
}
