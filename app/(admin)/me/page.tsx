import { requireStaff } from "@/lib/auth";
import { BarChart3, ChevronRight, Mail, Settings } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Me" };

/**
 * /me -- landing hub for operator-scoped pages.
 *
 * Without this page, /me would 404 even though /me/activity and
 * /me/inbox-health both exist as direct routes. Adds a simple
 * card list so the URL is discoverable and bookmarkable, and so
 * the user-menu's two items have a parent surface they belong to.
 *
 * Auth: requireStaff. No team-scope leak risk -- the page renders
 * only static links + the operator's display name.
 */
export default async function MeIndexPage() {
  const { staff } = await requireStaff();
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10">
      <header className="mb-8">
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em]">me</p>
        <h1 className="mt-1 font-semibold text-3xl tracking-tight">{staff.displayName}</h1>
        <p className="mt-1 text-sm text-zinc-500">{staff.primaryEmail}</p>
      </header>

      <section className="grid gap-3">
        <HubCard
          href="/me/activity"
          icon={<BarChart3 className="h-4 w-4 text-zinc-500" />}
          title="My activity"
          subtitle="Calls, emails sent, SMS, replies. Last 7-365 days."
        />
        <HubCard
          href="/me/inbox-health"
          icon={<Mail className="h-4 w-4 text-zinc-500" />}
          title="Inbox health"
          subtitle="Send-cap usage, sync status, unread + stale counts."
        />
        <HubCard
          href="/me/preferences"
          icon={<Settings className="h-4 w-4 text-zinc-500" />}
          title="Preferences"
          subtitle="Daily digest opt-in and other personal settings."
        />
      </section>
    </main>
  );
}

function HubCard({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="card-surface group flex items-center gap-3 px-5 py-4 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
    >
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
