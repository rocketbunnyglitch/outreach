import { cn } from "@/lib/cn";
import type { ActivityFeedRow } from "@/lib/team-analytics";
import { CheckCircle2, Clock, Mail, MessageSquare, PhoneCall, XCircle } from "lucide-react";
import Link from "next/link";

interface Props {
  rows: ActivityFeedRow[];
}

const CHANNEL_ICON: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  call: { icon: PhoneCall, tone: "text-blue-500" },
  email: { icon: Mail, tone: "text-emerald-500" },
  sms: { icon: MessageSquare, tone: "text-orange-500" },
};

const OUTCOME_TONE: Record<string, string> = {
  sent: "text-zinc-500",
  confirmed: "text-emerald-600 dark:text-emerald-400",
  interested: "text-emerald-600 dark:text-emerald-400",
  callback_requested: "text-blue-600 dark:text-blue-400",
  voicemail: "text-amber-600 dark:text-amber-400",
  no_answer: "text-amber-600 dark:text-amber-400",
  declined: "text-rose-600 dark:text-rose-400",
  bounced: "text-rose-600 dark:text-rose-400",
  bad_email: "text-rose-600 dark:text-rose-400",
  wrong_number: "text-rose-600 dark:text-rose-400",
};

const POSITIVE_OUTCOMES = new Set(["confirmed", "interested", "callback_requested"]);
const NEGATIVE_OUTCOMES = new Set(["declined", "bounced", "bad_email", "wrong_number"]);

/**
 * Recent activity feed — chronological list of this operator's last
 * 30 outreach_log entries.
 *
 * Each row:
 *   icon (by channel) → venue link → city · outcome → notes snippet
 *   → relative timestamp
 *
 * Positive outcomes get a green CheckCircle2 badge; negative get a
 * rose XCircle. Neutral (sent, voicemail, etc.) get a quiet clock.
 */
export function ActivityFeed({ rows }: Props) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <header className="border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <div className="flex items-baseline gap-2">
          <Clock className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-sm tracking-tight">Recent activity</h2>
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            last {rows.length}
          </span>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-zinc-500 italic">
          No activity logged yet.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200/40 dark:divide-zinc-800/30">
          {rows.map((r) => {
            const channelMeta = CHANNEL_ICON[r.channel] ?? CHANNEL_ICON.call;
            const ChannelIcon = channelMeta?.icon ?? PhoneCall;
            const channelTone = channelMeta?.tone ?? "text-zinc-500";
            return (
              <li
                key={r.logId}
                className="flex items-start gap-3 px-5 py-2.5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-900/30"
              >
                <ChannelIcon className={cn("mt-1 h-3 w-3 shrink-0", channelTone)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <Link
                      href={`/venues/${r.venueId}`}
                      className="font-medium text-xs text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
                    >
                      {r.venueName}
                    </Link>
                    {r.cityName && (
                      <span className="font-mono text-[10px] text-zinc-500">{r.cityName}</span>
                    )}
                    <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.08em]">
                      ·
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.08em]",
                        OUTCOME_TONE[r.outcome] ?? "text-zinc-500",
                      )}
                    >
                      {r.outcome.replace("_", " ")}
                    </span>
                  </div>
                  {r.notes && (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                      {r.notes}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <OutcomeBadge outcome={r.outcome} />
                  <p className="font-mono text-[9px] text-zinc-500 tabular-nums">
                    {formatRelative(r.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  if (POSITIVE_OUTCOMES.has(outcome)) {
    return <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-label={outcome} />;
  }
  if (NEGATIVE_OUTCOMES.has(outcome)) {
    return <XCircle className="h-3 w-3 text-rose-500" aria-label={outcome} />;
  }
  return null;
}

function formatRelative(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return then.toISOString().slice(5, 10);
}
