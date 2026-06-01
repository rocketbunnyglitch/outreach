import { requireAdmin } from "@/lib/auth";
import { loadConversionFunnel } from "@/lib/template-analytics";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * /admin/analytics/funnel — team-wide cold-outreach funnel.
 *
 * Phase C.2 of the email-system audit. Shows sent → replied →
 * warm-or-better → confirmed, plus declined + bounced sidebars.
 * Operators read this to spot leaks: high sends + low replies =
 * subject lines are weak; high replies + low warm = template
 * tone is off; high warm + low confirmed = closing isn't landing.
 */
export default async function FunnelAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { staff } = await requireAdmin();
  const params = await searchParams;
  const windowDays = Number(params.window ?? "90");
  const days = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 90;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const f = await loadConversionFunnel({ teamId: staff.teamId, from });

  const stages = [
    {
      key: "sent",
      label: "Sent",
      value: f.sent,
      sub: null as string | null,
      tone: "zinc",
    },
    {
      key: "replied",
      label: "Replied",
      value: f.replied,
      sub: pctOf(f.replied, f.sent),
      tone: "blue",
    },
    {
      key: "warm",
      label: "Warm or better",
      value: f.warmOrBetter,
      sub: pctOf(f.warmOrBetter, f.sent),
      tone: "violet",
    },
    {
      key: "confirmed",
      label: "Confirmed",
      value: f.confirmed,
      sub: pctOf(f.confirmed, f.sent),
      tone: "emerald",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-10">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
            admin · conversion funnel
          </p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">Funnel</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cold sends → reply → warm → confirmed over the last {days} days.
          </p>
        </div>
        <WindowPicker active={days} />
      </header>

      {f.sent === 0 ? (
        <div className="rounded-xl border border-zinc-200 border-dashed bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/20">
          <p className="text-sm text-zinc-500">No cold sends in the last {days} days.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {stages.map((s) => (
              <FunnelCard key={s.key} label={s.label} value={s.value} sub={s.sub} tone={s.tone} />
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <SideCard
              label="Declined / unsubscribed"
              value={f.declined}
              sub={pctOf(f.declined, f.sent)}
              tone="rose"
              hint="Hard NOs. High decline rate = mistargeting or wrong tone."
            />
            <SideCard
              label="Bounced"
              value={f.bounced}
              sub={null}
              tone="amber"
              hint="Bad addresses. Sustained bouncing hurts deliverability — pause + review your list."
            />
          </div>
        </>
      )}
    </main>
  );
}

function FunnelCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub: string | null;
  tone: string;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-5 dark:bg-zinc-950 ${TONE_BORDER[tone] ?? "border-zinc-200 dark:border-zinc-800"}`}
    >
      <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">{label}</p>
      <p className={`mt-2 font-semibold text-3xl tracking-tight ${TONE_TEXT[tone] ?? ""}`}>
        {value.toLocaleString("en-US")}
      </p>
      {sub && <p className="mt-1 font-mono text-[11px] text-zinc-500">{sub} of sent</p>}
    </div>
  );
}

function SideCard({
  label,
  value,
  sub,
  tone,
  hint,
}: {
  label: string;
  value: number;
  sub: string | null;
  tone: string;
  hint: string;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 dark:bg-zinc-950 ${TONE_BORDER[tone] ?? "border-zinc-200 dark:border-zinc-800"}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">{label}</p>
        <p className={`font-semibold text-2xl tracking-tight ${TONE_TEXT[tone] ?? ""}`}>
          {value.toLocaleString("en-US")}
          {sub && <span className="ml-1.5 font-mono text-[11px] text-zinc-500">{sub}</span>}
        </p>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

function WindowPicker({ active }: { active: number }) {
  const opts = [30, 60, 90, 180];
  return (
    <nav className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950">
      {opts.map((d) => (
        <Link
          key={d}
          href={`/admin/analytics/funnel?window=${d}`}
          className={`rounded-md px-2.5 py-1 font-mono text-[11px] ${
            d === active
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {d}d
        </Link>
      ))}
    </nav>
  );
}

const TONE_BORDER: Record<string, string> = {
  zinc: "border-zinc-200 dark:border-zinc-800",
  blue: "border-blue-200 dark:border-blue-900/40",
  violet: "border-violet-200 dark:border-violet-900/40",
  emerald: "border-emerald-200 dark:border-emerald-900/40",
  rose: "border-rose-200 dark:border-rose-900/40",
  amber: "border-amber-200 dark:border-amber-900/40",
};

const TONE_TEXT: Record<string, string> = {
  zinc: "text-zinc-900 dark:text-zinc-100",
  blue: "text-blue-600 dark:text-blue-300",
  violet: "text-violet-600 dark:text-violet-300",
  emerald: "text-emerald-600 dark:text-emerald-300",
  rose: "text-rose-600 dark:text-rose-300",
  amber: "text-amber-600 dark:text-amber-300",
};

function pctOf(n: number, total: number): string | null {
  if (total === 0) return null;
  return `${((n / total) * 100).toFixed(1)}%`;
}
