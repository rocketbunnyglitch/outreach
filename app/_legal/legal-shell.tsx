/**
 * Legal-page primitives — shared chrome for /privacy + /terms.
 *
 * Distinct from the in-app layout because Google's OAuth verifiers
 * (and any unauthenticated visitor) need to land on these pages
 * without a session. We deliberately keep the visual surface plain:
 *   - High contrast type
 *   - Generous max-width for readability
 *   - No marketing fluff, no animations, no JS-only widgets
 *   - The PERSE brand mark + a single home link
 *
 * Server-rendered, no client interactivity needed.
 */

import Link from "next/link";

export function LegalShell({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  /** ISO date the policy took effect. Rendered as "Effective {date}". */
  effectiveDate: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
      <header className="border-zinc-200 border-b pb-6 dark:border-zinc-800">
        <Link
          href="/"
          className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em] hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          PERSE
        </Link>
        <h1 className="mt-4 font-semibold text-3xl tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-2 font-mono text-[11px] text-zinc-500 uppercase tracking-[0.1em]">
          Effective {effectiveDate}
        </p>
      </header>
      <div className="prose prose-zinc dark:prose-invert mt-8 max-w-none text-[15px] leading-relaxed">
        {children}
      </div>
      <footer className="mt-16 border-zinc-200 border-t pt-6 font-mono text-[11px] text-zinc-500 uppercase tracking-[0.12em] dark:border-zinc-800">
        <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Privacy
        </Link>
        <span className="mx-2 opacity-40">·</span>
        <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Terms
        </Link>
        <span className="mx-2 opacity-40">·</span>
        <a
          href="mailto:privacy@barcrawlconnect.com"
          className="hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          privacy@barcrawlconnect.com
        </a>
      </footer>
    </main>
  );
}

/**
 * Section heading inside a legal page. Numbered for easy reference
 * during Google's verification ("see section 4.2 of our privacy
 * policy"). Renders as h2 for accessibility but visually tighter.
 */
export function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mt-0 mb-3 font-semibold text-xl tracking-tight">
        <span className="font-mono text-[12px] text-zinc-500 tracking-[0.08em]">{number}</span>
        <span className="ml-3">{title}</span>
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
