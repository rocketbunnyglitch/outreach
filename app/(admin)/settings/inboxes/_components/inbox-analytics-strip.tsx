/**
 * InboxAnalyticsStrip — compact 30-day rollup for one inbox.
 *
 * Renders inline on /settings/inboxes rows: reply rate, bounce rate,
 * stale-thread count, and the derived health pill. Numbers stay
 * tabular-nums + font-mono to match the rest of the engine's data
 * tone.
 *
 * Empty-window safety: when the inbox has had ≤ 10 cold sends in
 * the window, we don't show rates (insufficient signal). The
 * health classifier puts these in the 'warming' tier and the strip
 * renders "no data yet" instead of "0%" which would imply a real
 * failure.
 */

import { cn } from "@/lib/cn";
import type { HealthTier, InboxAnalytics } from "@/lib/inbox-analytics";
import { AlertTriangle, CheckCircle2, Sparkles, Unplug } from "lucide-react";

const PCT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

interface Props {
  analytics: InboxAnalytics;
  health: HealthTier;
}

export function InboxAnalyticsStrip({ analytics, health }: Props) {
  const tooFewSends = analytics.coldSends < 10;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
      <HealthPill health={health} />

      {tooFewSends ? (
        <span className="text-zinc-400">
          {analytics.coldSends} cold sends · need ≥ 10 for rates
        </span>
      ) : (
        <>
          <Stat
            label="reply"
            value={PCT.format(analytics.replyRate)}
            tone={analytics.replyRate >= 0.1 ? "good" : "neutral"}
            title={`${analytics.replies} replies on ${analytics.coldSends} cold sends (30d)`}
          />
          <Stat
            label="bounce"
            value={PCT.format(analytics.bounceRate)}
            tone={
              analytics.bounceRate >= 0.05 ? "bad" : analytics.bounceRate >= 0.02 ? "warn" : "good"
            }
            title={`${analytics.bounces} bounced on ${analytics.coldSends} cold sends (30d)`}
          />
        </>
      )}

      {analytics.staleThreads > 0 && (
        <span
          className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
          title="Open threads owned by this inbox flagged stale by the SLA worker"
        >
          <AlertTriangle className="h-3 w-3" />
          {analytics.staleThreads} stale
        </span>
      )}
    </div>
  );
}

function HealthPill({ health }: { health: HealthTier }) {
  switch (health) {
    case "healthy":
      return (
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          healthy
        </span>
      );
    case "warming":
      return (
        <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
          <Sparkles className="h-3 w-3" />
          warming
        </span>
      );
    case "needs_attention":
      return (
        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-3 w-3" />
          needs attention
        </span>
      );
    case "disconnected":
      return (
        <span className="inline-flex items-center gap-1 text-zinc-500">
          <Unplug className="h-3 w-3" />
          disconnected
        </span>
      );
  }
}

function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        tone === "good" && "text-emerald-600 dark:text-emerald-400",
        tone === "warn" && "text-amber-600 dark:text-amber-400",
        tone === "bad" && "text-rose-600 dark:text-rose-400",
        tone === "neutral" && "text-zinc-500",
      )}
    >
      <span className="text-zinc-400">{label}</span>
      {value}
    </span>
  );
}
