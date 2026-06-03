"use client";

/**
 * CityTime — shows the current time in the city alongside the viewer's
 * local time. Updates once a minute (we don't need second-precision for
 * "is now a reasonable time to call?").
 *
 * Both formatted via Intl.DateTimeFormat with explicit timeZone so the
 * server-rendered output matches the eventual client-rendered output
 * (no hydration mismatch).
 *
 * Why client-side?
 *   The "viewer's local time" depends on the operator's browser tz, so
 *   we render it via Date.now() in the client. The city time is also
 *   derived from Date.now(); just formatted in the city's IANA tz.
 *
 *   Server could pre-compute both, but the page would stale within a
 *   minute. Keeping it client-side means a single render path and the
 *   1-minute tick keeps both fresh.
 */

import { useEffect, useState } from "react";

interface Props {
  cityName: string;
  cityTimezone: string;
  viewerTimezone: string;
}

export function CityTime({ cityName, cityTimezone, viewerTimezone }: Props) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    // SSR placeholder — same shape as the client output, just blank
    return (
      <div className="flex items-baseline gap-3 font-mono text-[11px] text-zinc-500 tabular-nums">
        <span>—</span>
      </div>
    );
  }

  const cityFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: cityTimezone,
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
    hour12: true,
  });
  const viewerFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: viewerTimezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const cityTime = cityFormatter.format(now);
  const viewerTime = viewerFormatter.format(now);
  const sameTz = cityTimezone === viewerTimezone;

  // Time-of-day signal: green for reasonable calling hours (9-21 in city),
  // amber for borderline (7-9, 21-22), gray for night/early morning.
  const cityHour = Number.parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: cityTimezone,
      hour: "numeric",
      hour12: false,
    }).format(now),
    10,
  );
  let dotColor = "bg-zinc-400";
  let dotTitle = "outside typical calling hours";
  if (cityHour >= 9 && cityHour < 21) {
    dotColor = "bg-emerald-500";
    dotTitle = "good time to call";
  } else if ((cityHour >= 7 && cityHour < 9) || (cityHour >= 21 && cityHour < 22)) {
    dotColor = "bg-amber-500";
    dotTitle = "borderline calling time";
  }

  return (
    <div className="flex items-baseline gap-3 font-mono text-[11px] text-zinc-500 tabular-nums">
      <span className="flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`}
          title={dotTitle}
          aria-hidden="true"
        />
        <span className="text-zinc-700 dark:text-zinc-300">
          {cityTime} {cityName}
        </span>
      </span>
      {!sameTz && (
        <span className="text-zinc-400" title={`Your local time (${viewerTimezone})`}>
          · {viewerTime} for you
        </span>
      )}
    </div>
  );
}
