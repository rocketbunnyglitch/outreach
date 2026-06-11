/**
 * /admin/command — the manager's problems-only morning screen
 * (CRM plan C4).
 *
 * One flat list of everything that needs a DECISION right now: at-risk
 * crawls, NBA fire-drills, the cancellation-review queue, silent or
 * failing crons, broken sending inboxes, erroring scheduled sends, and
 * backup failures. Every row deep-links to the surface where it gets
 * fixed. Zero problems renders a deliberately calm empty state — if
 * this page is quiet, the operation is healthy and the manager can go
 * do growth work instead of firefighting.
 */

import { requireAdmin } from "@/lib/auth";
import { loadCommandCenter } from "@/lib/command-center-data";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { ArrowRight, CheckCircle2, Siren } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Command · Admin" };
export const dynamic = "force-dynamic";

const SOURCE_CHIP: Record<string, string> = {
  crawl: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  "fire drill": "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  cancellation: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  system: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  sending: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  backup: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export default async function CommandPage() {
  await requireAdmin();
  const current = await getCurrentCampaign();
  const items = await loadCommandCenter(current?.campaign.id ?? null);
  const reds = items.filter((i) => i.severity === "red").length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <Siren className="h-5 w-5 text-zinc-400" />
        <div>
          <h1 className="font-semibold text-xl tracking-tight">Command</h1>
          <p className="text-sm text-zinc-500">
            {items.length === 0
              ? "Everything that would need a decision, in one place."
              : `${items.length} item${items.length > 1 ? "s" : ""} need${
                  items.length === 1 ? "s" : ""
                } a decision${reds > 0 ? ` — ${reds} urgent` : ""}.`}
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 border-dashed bg-emerald-50/40 px-6 py-14 text-center dark:border-emerald-900/40 dark:bg-emerald-950/10">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <p className="font-medium text-emerald-800 text-sm dark:text-emerald-200">
            Nothing needs a decision.
          </p>
          <p className="max-w-sm text-emerald-700/80 text-xs dark:text-emerald-300/70">
            No at-risk crawls, no fire-drills, no cancellation reviews, crons running, inboxes
            connected, queue clean, backups good. Go do growth work.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                  item.severity === "red"
                    ? "border-rose-200 dark:border-rose-900/40"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    item.severity === "red" ? "bg-rose-500" : "bg-amber-500"
                  }`}
                />
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${
                    SOURCE_CHIP[item.source] ?? SOURCE_CHIP.backup
                  }`}
                >
                  {item.source}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500">
                  {item.cta} <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
