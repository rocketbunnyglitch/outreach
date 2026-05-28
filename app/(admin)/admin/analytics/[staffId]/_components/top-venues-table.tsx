import { cn } from "@/lib/cn";
import type { TopVenueRow } from "@/lib/team-analytics";
import { Building2, Mail, MessageCircle, MessageSquare, PhoneCall } from "lucide-react";
import Link from "next/link";

interface Props {
  rows: TopVenueRow[];
}

/**
 * Top 10 venues this operator has touched in the window, sorted by
 * total touches DESC. Each row links into the venue detail page.
 *
 * Per-row breakdown: name + city + total + per-channel chip + last
 * touch relative date.
 */
export function TopVenuesTable({ rows }: Props) {
  return (
    <section className="overflow-hidden card-surface">
      <header className="border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <div className="flex items-baseline gap-2">
          <Building2 className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-sm tracking-tight">Most-touched venues</h2>
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            top {rows.length}
          </span>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-zinc-500 italic">
          No venue touches yet in this window.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200/40 dark:divide-zinc-800/30">
          {rows.map((r, i) => (
            <li key={r.venueId}>
              <Link
                href={`/venues/${r.venueId}`}
                className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-blue-500/[0.03]"
              >
                <span className="w-5 shrink-0 text-right font-mono text-[10px] text-zinc-400 tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
                    {r.venueName}
                  </p>
                  {r.cityName && (
                    <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">
                      {r.cityName} · last touch {formatRelative(r.lastTouchAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {r.calls > 0 && (
                    <Chip
                      icon={PhoneCall}
                      value={r.calls}
                      tone="bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300"
                    />
                  )}
                  {r.emails > 0 && (
                    <Chip
                      icon={Mail}
                      value={r.emails}
                      tone="bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300"
                    />
                  )}
                  {r.sms > 0 && (
                    <Chip
                      icon={MessageSquare}
                      value={r.sms}
                      tone="bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300"
                    />
                  )}
                  {r.viber > 0 && (
                    <Chip
                      icon={MessageCircle}
                      value={r.viber}
                      tone="bg-purple-500/10 text-purple-700 ring-purple-500/20 dark:text-purple-300"
                    />
                  )}
                  <span className="ml-1 w-8 text-right font-mono font-semibold text-[11px] text-zinc-900 tabular-nums dark:text-zinc-100">
                    {r.totalTouches}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Chip({
  icon: Icon,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  tone: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium font-mono text-[10px] tabular-nums ring-1 ring-inset",
        tone,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {value}
    </span>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return then.toISOString().slice(0, 10);
}
