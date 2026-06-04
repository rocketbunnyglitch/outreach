/**
 * WorklistSection - shared shell for the four /worklist sections (Phase 2.1).
 *
 * A titled card with an icon + optional count badge, wrapping each section's
 * body. WorklistEmpty renders the per-section empty state. Real data wiring for
 * each section lands in Phase 2.2-2.6; this scaffold keeps their chrome
 * consistent so those phases only fill in the body.
 */

import type { ReactNode } from "react";

export function WorklistSection({
  title,
  subtitle,
  icon,
  count,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-zinc-200 border-b px-4 py-3 dark:border-zinc-800/60">
        <div className="flex items-center gap-2.5">
          <span className="text-zinc-500">{icon}</span>
          <div>
            <h2 className="font-semibold text-sm tracking-tight">{title}</h2>
            <p className="text-xs text-zinc-500">{subtitle}</p>
          </div>
        </div>
        {typeof count === "number" && count > 0 ? (
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-white tabular-nums dark:bg-zinc-100 dark:text-zinc-900">
            {count}
          </span>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function WorklistEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 border-dashed p-8 text-center dark:border-zinc-800">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  );
}
