/**
 * /admin/data-quality — the weekly hygiene sweep (CRM plan D2).
 *
 * Six aggregate checks over the live data (lib/data-quality), each
 * rendered as count + sample rows + a deep link to the surface where
 * the class of problem actually gets fixed. Clean checks collapse to
 * a single green line — the page reads as a checklist, not a report.
 */

import { requireAdmin } from "@/lib/auth";
import { runIntegrityChecks } from "@/lib/data-integrity";
import { loadDataQuality } from "@/lib/data-quality";
import { ArrowRight, CheckCircle2, Database, Link2 } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Data quality · Admin" };
export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  await requireAdmin();
  const [checks, integrity] = await Promise.all([loadDataQuality(), runIntegrityChecks()]);
  const dirty = checks.filter((c) => c.count > 0);
  const clean = checks.filter((c) => c.count === 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <Database className="h-5 w-5 text-zinc-400" />
        <div>
          <h1 className="font-semibold text-xl tracking-tight">Data quality</h1>
          <p className="text-sm text-zinc-500">
            {dirty.length === 0
              ? "All checks clean."
              : `${dirty.length} of ${checks.length} checks need attention.`}{" "}
            Fixes happen on the normal surfaces — this page just finds the work.
          </p>
        </div>
      </header>

      {/* Linkage integrity (FULL_AUDIT P006): invariants between stores that
          record the same fact. Renders only when something is broken. */}
      {integrity.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-rose-200 p-4 dark:border-rose-900/40">
          <h2 className="flex items-center gap-2 font-semibold text-sm">
            <Link2 className="h-4 w-4 text-rose-500" /> Linkage integrity findings
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {integrity.map((f) => (
              <li key={f.name} className="flex items-baseline justify-between gap-3">
                <span>{f.desc}</span>
                <span className="shrink-0 font-mono text-rose-600 dark:text-rose-400">
                  {f.count === -1 ? "check broken" : f.count}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-zinc-500">
            Same-fact stores disagreeing — the email-analytics-class bug. Run
            scripts/audit-data-links.sh for the full 21-check detail.
          </p>
        </section>
      )}

      {dirty.map((c) => (
        <section
          key={c.key}
          className="flex flex-col gap-2 rounded-xl border border-amber-200 p-4 dark:border-amber-900/40"
        >
          <header className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-sm">
              {c.title}{" "}
              <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {c.count}
              </span>
            </h2>
            <Link
              href={c.fixHref}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {c.fixLabel} <ArrowRight className="h-3 w-3" />
            </Link>
          </header>
          <p className="text-xs text-zinc-500">{c.why}</p>
          {c.samples.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {c.samples.map((s) => (
                <li key={`${c.key}:${s.href}:${s.label}`}>
                  <Link
                    href={s.href}
                    className="font-mono text-[11px] text-zinc-600 hover:underline dark:text-zinc-300"
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
              {c.count > c.samples.length && (
                <li className="font-mono text-[11px] text-zinc-400">
                  … and {c.count - c.samples.length} more
                </li>
              )}
            </ul>
          )}
        </section>
      ))}

      {clean.length > 0 && (
        <section className="flex flex-col gap-1.5 rounded-xl border border-emerald-200 border-dashed p-4 dark:border-emerald-900/40">
          {clean.map((c) => (
            <p
              key={c.key}
              className="flex items-center gap-2 text-emerald-700 text-xs dark:text-emerald-300"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> {c.title}: clean
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
