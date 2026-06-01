"use client";

/**
 * PrimeTimePill — operator-facing reminder pill in the TopBar.
 *
 * Operator session 11 carryover:
 *   "Outreach prime-time banner (3-9pm local highlighted 4-7)"
 *
 * The pill renders ONLY when the staff member's local time is inside
 * the calling window:
 *
 *   - 4:00 PM – 7:00 PM local: "Prime time" — strong amber, the highest
 *     conversion window of the day. The label is the operator's cue to
 *     prioritize calls right now.
 *   - 3:00 PM – 4:00 PM and 7:00 PM – 9:00 PM local: "Outreach hours" —
 *     muted green, still good but not peak. Reads as "you can call".
 *   - Otherwise: nothing rendered. The TopBar collapses to its normal
 *     layout outside the calling window.
 *
 * "Local" means the staff member's recorded IANA timezone (from
 * staffMembers.timezone, defaults to America/Toronto). The hour is
 * computed from a real-clock tick each minute so the pill flips state
 * without a page reload as the operator hits a window boundary.
 *
 * Why minute-granularity not second
 * ---------------------------------
 * The boundary check only changes state on the hour. Polling every
 * minute is plenty; per-second would burn render cycles for nothing
 * and confuse React DevTools with constant rerenders.
 *
 * Why use Intl.DateTimeFormat instead of date-fns-tz
 * --------------------------------------------------
 * Intl is built-in, zero-bundle. We only need the local hour as a
 * number, and DateTimeFormat with timeZone option does that natively.
 */

import { cn } from "@/lib/cn";
import { useEffect, useState } from "react";

interface Props {
  /** IANA timezone of the operator (staffMembers.timezone). */
  timezone: string;
}

type Window = "prime" | "secondary" | "off";

/**
 * Classify a Date into our 3-tier window using the staff member's
 * timezone. Pure for testability — pass the timezone explicitly
 * rather than reading a hook.
 */
export function classifyTimeWindow(d: Date, timezone: string): Window {
  let hour: number;
  try {
    // Intl returns a 2-digit string like "16" — parse to number.
    // The 'hour12: false' guarantees 0-23 range so 13 isn't '1'.
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    });
    hour = Number.parseInt(formatter.format(d), 10);
  } catch {
    // Fallback if the timezone string is invalid (very rare — Intl
    // accepts most IANA names). Treat as off-hours so we don't show
    // a misleading badge.
    return "off";
  }
  if (Number.isNaN(hour)) return "off";
  if (hour >= 16 && hour < 19) return "prime"; // 4:00 PM – 6:59 PM
  if ((hour >= 15 && hour < 16) || (hour >= 19 && hour < 21)) return "secondary"; // 3-4, 7-9
  return "off";
}

export function PrimeTimePill({ timezone }: Props) {
  // Start "off" (renders nothing) so SSR and the first client render match.
  // Computing classifyTimeWindow(new Date(), …) in the useState initializer
  // ran on the server clock AND the client clock; near a window boundary they
  // classified differently → the rendered pill mismatched → React #418. The
  // real value is computed on mount (post-hydration) in the effect below.
  const [window, setWindow] = useState<Window>("off");

  useEffect(() => {
    function tick() {
      setWindow(classifyTimeWindow(new Date(), timezone));
    }
    // Compute immediately on mount, then align to the next minute boundary so
    // every operator's pill flips at the same wall-clock instant. After that,
    // fall back to a 60s interval.
    tick();
    const now = new Date();
    const msToNextMinute = 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
    let interval: ReturnType<typeof setInterval> | null = null;
    const initial = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(initial);
      if (interval) clearInterval(interval);
    };
  }, [timezone]);

  if (window === "off") return null;

  return (
    <span
      className={cn(
        "hidden items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-[11px] sm:inline-flex",
        window === "prime"
          ? "bg-amber-500/[0.14] text-amber-900 dark:bg-amber-500/[0.20] dark:text-amber-100"
          : "bg-emerald-500/[0.10] text-emerald-900 dark:bg-emerald-500/[0.18] dark:text-emerald-100",
      )}
      title={
        window === "prime"
          ? "4–7pm local: highest conversion call window"
          : "3–9pm local: standard outreach hours"
      }
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          window === "prime" ? "animate-pulse bg-amber-500" : "bg-emerald-500",
        )}
        aria-hidden
      />
      {window === "prime" ? "Prime time" : "Outreach hours"}
    </span>
  );
}
