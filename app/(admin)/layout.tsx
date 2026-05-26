import { ShortcutProvider } from "@/components/ui/shortcut-provider";
import { StaleDataIndicator } from "@/components/ui/stale-data-indicator";
import { ToastProvider } from "@/components/ui/toast";
import { requireStaff } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { CampaignSwitcher } from "./_components/campaign-switcher";
import { GlobalShortcuts } from "./_components/global-shortcuts";
import { MobileNav } from "./_components/mobile-nav";
import { MountCommandPalette } from "./_components/mount-command-palette";
import { NotificationsBell } from "./_components/notifications-bell";
import { ShortcutsHintButton } from "./_components/shortcuts-hint-button";
import { UserMenu } from "./_components/user-menu";

/**
 * Admin shell layout.
 *
 * Every route under (admin) requires authentication. `requireStaff` here
 * redirects to /login if there's no active session. The redirect happens
 * on the server before any page renders, so child pages can assume a
 * staff member is present.
 *
 * Phase 3 changes from Phase 2:
 *   - Demo-mode banner is now provider-aware: only shown when signed in
 *     via the dev impersonation provider (NODE_ENV !== production).
 *   - Top nav now shows the current staff member with sign-out affordance.
 *   - A placeholder slot exists in the nav for the campaign switcher;
 *     it stays empty until Phase 4 ships the campaigns table.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { staff, provider } = await requireStaff();
  const isDevImpersonation = provider === "dev-staff-impersonate";

  return (
    <ToastProvider>
      <ShortcutProvider>
        <div className="flex min-h-screen flex-col">
          {isDevImpersonation && <DevModeBanner />}
          <TopNav staff={staff} provider={provider} />
          <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:px-10 sm:py-14">
            {children}
          </main>
          <GlobalShortcuts />
          <MountCommandPalette />
          <StaleDataIndicator />
        </div>
      </ShortcutProvider>
    </ToastProvider>
  );
}

function DevModeBanner() {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 border-amber-200 border-b bg-amber-50",
        "px-4 py-1.5 font-medium text-[11px] text-amber-900 uppercase tracking-wider",
        "dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
      )}
    >
      <ShieldAlert className="h-3 w-3" />
      Dev impersonation — sign-in flow not via real OAuth
    </div>
  );
}

function TopNav({
  staff,
  provider,
}: {
  staff: Awaited<ReturnType<typeof requireStaff>>["staff"];
  provider: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-zinc-200 border-b bg-[color:var(--color-canvas)]/85 backdrop-blur-md dark:border-zinc-800 dark:bg-[color:var(--color-canvas-dark)]/85">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6 sm:px-10">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-baseline gap-2 font-semibold text-xl tracking-tight "
          >
            <span className="text-zinc-900 dark:text-zinc-100">Crawl</span>
            <span className="text-zinc-400 dark:text-zinc-500">Engine</span>
          </Link>

          <CampaignSwitcher />

          <nav className="hidden items-center gap-1 text-sm md:flex">
            <NavLink href="/brands">Brands</NavLink>
            <NavLink href="/campaigns">Campaigns</NavLink>
            <NavLink href="/all-crawls">All Crawls</NavLink>
            <NavLink href="/crawl-matrix">Crawl Matrix</NavLink>
            <NavLink href="/calendar">Calendar</NavLink>
            <NavLink href="/inbox">Inbox</NavLink>
            <NavLink href="/send-queue">Send Queue</NavLink>
            <NavLink href="/wristbands">Wristbands</NavLink>
            <NavLink href="/cities">Cities</NavLink>
            <NavLink href="/venues">Venues</NavLink>
            <NavLink href="/cluster-builder">Clusters</NavLink>
            <NavLink href="/middle-groups">Middles</NavLink>
            <NavLink href="/goals">Goals</NavLink>
            <NavLink href="/tasks">Tasks</NavLink>
            <NavLink href="/discover">Discover</NavLink>
            <NavLink href="/import">Import</NavLink>
            <NavLink href="/templates">Templates</NavLink>
            <NavLink href="/settings/inboxes">Settings</NavLink>
            {staff.role === "admin" && (
              <>
                <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" aria-hidden="true" />
                <NavLink href="/admin">Admin</NavLink>
                <NavLink href="/admin/analytics">Analytics</NavLink>
                <NavLink href="/audit">Audit</NavLink>
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <NotificationsBell />
          <ShortcutsHintButton />
          <UserMenu staff={staff} provider={provider} />
          <MobileNav isAdmin={staff.role === "admin"} />
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
  disabled,
}: {
  href: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        className="cursor-not-allowed rounded-md px-3 py-1.5 text-zinc-300 dark:text-zinc-700"
        title="Coming in a later phase"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {children}
    </Link>
  );
}
