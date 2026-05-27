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
import { SideNav } from "./_components/side-nav";
import { UserMenu } from "./_components/user-menu";

/**
 * Admin shell layout.
 *
 * Sidebar nav (SideNav) for primary navigation + a slim top bar that
 * carries logo, campaign switcher, notifications, user menu.
 *
 * Previous shell put 18 nav items in a horizontal bar which read as
 * "menu" rather than "tabs between sheets". The sidebar groups them
 * into Today / Operate / Data / (Admin) sections and shows the active
 * route with a high-contrast pill, matching the metaphor Sheets users
 * expect.
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
          <TopBar staff={staff} provider={provider} />
          <div className="flex flex-1">
            <SideNav isAdmin={staff.role === "admin"} />
            <main className="min-w-0 flex-1 px-6 py-10 sm:px-10 sm:py-14">{children}</main>
          </div>
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

function TopBar({
  staff,
  provider,
}: {
  staff: Awaited<ReturnType<typeof requireStaff>>["staff"];
  provider: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-zinc-200 border-b bg-[color:var(--color-canvas)]/85 backdrop-blur-md dark:border-zinc-800 dark:bg-[color:var(--color-canvas-dark)]/85">
      <div className="flex h-14 w-full items-center justify-between gap-4 px-6 sm:px-10">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-baseline gap-2 font-semibold text-xl tracking-tight "
          >
            <span className="text-zinc-900 dark:text-zinc-100">Crawl</span>
            <span className="text-zinc-400 dark:text-zinc-500">Engine</span>
          </Link>
          <CampaignSwitcher />
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
