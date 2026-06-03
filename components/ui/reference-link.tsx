import Link from "next/link";
import type { ReactNode } from "react";

const DEFAULT_DOC_SLUG = "halloween-2026-intl";

/**
 * Small badge/link to a section of the operator reference doc, e.g.
 * <ReferenceLink section="7.13.9" />. Use it in warnings, tooltips, and
 * explanation popups so operators can jump straight to the governing rule.
 */
export function ReferenceLink({
  section,
  slug = DEFAULT_DOC_SLUG,
  children,
}: {
  section: string;
  slug?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={`/reference/${slug}#${section}`}
      title={`Reference doc section ${section}`}
      className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
    >
      {children ?? `Ref ${section}`}
    </Link>
  );
}
