/**
 * Shared chrome for public-facing pages (homepage, features, security,
 * FAQ, contact, changelog, about, privacy, terms).
 *
 * Why these exist as separate components from the in-app layout:
 *   - Public pages don't require a session; the in-app side-nav assumes
 *     authenticated context (campaign switcher, staff profile, etc.)
 *   - Work content filters that flag "insufficient content" want
 *     consistent navigation across pages — a real site has a coherent
 *     header/footer + cross-links between sections
 *   - Google's OAuth verifiers need a polished public surface that
 *     describes the product
 *
 * Both components are server-rendered, no JS shipped beyond Next.js
 * link prefetching.
 */

import Image from "next/image";
import Link from "next/link";

interface NavLink {
  href: string;
  label: string;
}

const NAV_LINKS: NavLink[] = [
  { href: "/about", label: "About" },
  { href: "/features", label: "Features" },
  { href: "/security", label: "Security" },
  { href: "/faq", label: "FAQ" },
  { href: "/changelog", label: "Updates" },
  { href: "/contact", label: "Contact" },
];

const FOOTER_PRODUCT: NavLink[] = [
  { href: "/about", label: "About" },
  { href: "/features", label: "Features" },
  { href: "/security", label: "Security" },
  { href: "/changelog", label: "Updates" },
];

const FOOTER_RESOURCES: NavLink[] = [
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

/**
 * Top nav rendered on every public page. Mobile collapses to logo +
 * "Sign in" only; desktop shows the full link set + Sign in CTA.
 *
 * No mobile hamburger menu — the link set is small enough that the
 * footer cross-links carry the same coverage, and skipping JS for the
 * mobile menu keeps these pages dead-simple.
 */
export function PublicNav() {
  return (
    <nav className="border-zinc-200 border-b bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/about" className="flex items-center" aria-label="PERSE home">
          <Image
            src="/brand/perse-512-transparent.png"
            alt="PERSE"
            width={96}
            height={28}
            priority
            className="dark:invert"
          />
        </Link>
        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-medium text-[13px] text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <Link
          href="/login"
          className="rounded-md bg-zinc-900 px-3.5 py-1.5 font-medium text-[13px] text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Sign in
        </Link>
      </div>
    </nav>
  );
}

/**
 * Full-width public footer with cross-linked sitemap. Helps work
 * content filters see the site as a real multi-page site by giving
 * every page a complete sitemap link cluster.
 */
export function PublicFooter() {
  return (
    <footer className="mt-24 border-zinc-200 border-t bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-1">
            <Image
              src="/brand/perse-512-transparent.png"
              alt="PERSE"
              width={96}
              height={28}
              className="dark:invert"
            />
            <p className="mt-4 text-[13px] text-zinc-600 leading-relaxed dark:text-zinc-400">
              Outreach engine for multi-city bar-crawl event promoters. Connect Gmail, track every
              venue, ship every campaign.
            </p>
          </div>
          <div>
            <h3 className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.12em]">
              Product
            </h3>
            <ul className="mt-3 space-y-2">
              {FOOTER_PRODUCT.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[13px] text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.12em]">
              Resources
            </h3>
            <ul className="mt-3 space-y-2">
              {FOOTER_RESOURCES.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[13px] text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.12em]">
              Contact
            </h3>
            <ul className="mt-3 space-y-2">
              <li>
                <a
                  href="mailto:support@barcrawlconnect.com"
                  className="text-[13px] text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  support@barcrawlconnect.com
                </a>
              </li>
              <li>
                <a
                  href="mailto:privacy@barcrawlconnect.com"
                  className="text-[13px] text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  privacy@barcrawlconnect.com
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-start justify-between gap-2 border-zinc-200 border-t pt-6 text-[11px] text-zinc-500 md:flex-row md:items-center dark:border-zinc-800">
          <p className="font-mono uppercase tracking-[0.08em]">
            © {new Date().getFullYear()} BarCrawl Connect. All rights reserved.
          </p>
          <p className="font-mono uppercase tracking-[0.08em]">
            <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Privacy
            </Link>
            <span className="mx-2 opacity-40">·</span>
            <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              Terms
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

/**
 * Convenience wrapper — typical public page is `<PublicShell>content</PublicShell>`
 * with nav + footer rendered automatically. Pages that need control
 * over their own structure (e.g. /about with a custom hero) can use
 * PublicNav + PublicFooter directly.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicNav />
      {children}
      <PublicFooter />
    </>
  );
}
