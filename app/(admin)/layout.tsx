import { ShortcutProvider } from "@/components/ui/shortcut-provider";
import { StaleDataIndicator } from "@/components/ui/stale-data-indicator";
import { ToastProvider } from "@/components/ui/toast";
import { hasMinimumRole, requireStaff } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { getUserPreferences } from "@/lib/user-preferences";
import { ShieldAlert } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { CampaignSwitcher } from "./_components/campaign-switcher";
import { ComposerHost } from "./_components/composer/composer-host";
import { ComposerProvider } from "./_components/composer/composer-store";
import { GlobalPresence } from "./_components/global-presence";
import { GlobalShortcuts } from "./_components/global-shortcuts";
import { MobileSectionNav } from "./_components/mobile-section-nav";
import { MountCommandPalette } from "./_components/mount-command-palette";
import { NotificationsBell } from "./_components/notifications-bell";
import { PrimeTimePill } from "./_components/prime-time-pill";
import { RealtimeRefresh } from "./_components/realtime-refresh";
import { ShortcutsHintButton } from "./_components/shortcuts-hint-button";
import { SideNav } from "./_components/side-nav";
import { StaleDeployGuard } from "./_components/stale-deploy-guard";
import { ThemePrefHydrator } from "./_components/theme-pref-hydrator";
import { ThemeToggle } from "./_components/theme-toggle";
import { TimezonePicker } from "./_components/timezone-picker";
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
  // Used to default the Admin nav group to collapsed when a campaign
  // is scoped — admin views are usually irrelevant per-campaign.
  const currentCampaign = await getCurrentCampaign();
  const hasCurrentCampaign = !!currentCampaign;
  // Theme pref (saved to profile) -- seeds a fresh device's localStorage.
  const myPrefs = await getUserPreferences(staff.id).catch(() => null);

  return (
    <ToastProvider>
      <ShortcutProvider>
        <ComposerProvider>
          <GlobalPresence staffId={staff.id} />
          <ThemePrefHydrator dbTheme={myPrefs?.themePref ?? null} />
          <StaleDeployGuard />
          <div className="flex min-h-screen flex-col">
            {isDevImpersonation && <DevModeBanner />}
            <TopBar staff={staff} provider={provider} />
            {/* Mobile-only horizontal section + sub-nav strips. Renders
                under the TopBar at < lg viewports; hidden at lg+ where
                SideNav takes over. Replaces the old hamburger drawer
                (operator session 11). */}
            <MobileSectionNav
              isAdmin={hasMinimumRole(staff, "admin")}
              hasCurrentCampaign={hasCurrentCampaign}
            />
            <div className="flex flex-1">
              <SideNav
                isAdmin={hasMinimumRole(staff, "admin")}
                hasCurrentCampaign={hasCurrentCampaign}
              />
              <main className="min-w-0 flex-1 px-6 py-10 sm:px-10 sm:py-14">{children}</main>
            </div>
            <GlobalShortcuts />
            <MountCommandPalette />
            <StaleDataIndicator />
            {/* Live updates across every admin page: every committed mutation
                publishes a firehose event (withAuditContext) and this consumer
                soft-refreshes all open clients via SSE. */}
            <RealtimeRefresh currentStaffId={staff.id} />
            {/* Global Gmail-style composer. Renders bottom-right when at
                least one composer is open; persists across route changes
                because it's mounted at the layout level, not inside
                any page component. */}
            <ComposerHost />
          </div>
        </ComposerProvider>
      </ShortcutProvider>
    </ToastProvider>
  );
}

function DevModeBanner() {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 border-rose-200 border-b bg-rose-50",
        "px-4 py-1.5 font-medium text-[11px] text-rose-900 uppercase tracking-wider",
        "dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
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
      <div className="flex h-14 w-full items-center justify-between gap-2 px-4 sm:gap-4 sm:px-10">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <Link href="/" className="flex shrink-0 items-center" aria-label="Perse — home">
            {/*
              PERSE wordmark. Single transparent PNG (white pixels on
              transparent alpha) lives at /public/perse-wordmark.png.

              Themed via CSS filter rather than two separate PNGs:
                light mode: filter:brightness(0) → forces RGB to black
                            while preserving the alpha channel, so the
                            wordmark renders as crisp black on the
                            light canvas
                dark mode:  no filter → original white shows on the
                            near-black canvas

              Source is 1421x155 (~9.17:1). 28px tall fits the 56px
              h-14 top bar with comfortable breathing room; width
              scales from there. Next/Image handles the responsive
              srcSet + lazy is off (priority) because this lives in
              the always-visible header.
            */}
            <Image
              src="/perse-wordmark.png"
              alt="Perse"
              width={258}
              height={28}
              priority
              className={cn(
                "h-3 w-auto shrink-0 select-none sm:h-3.5",
                // Light mode: brightness(0) zeroes RGB → black wordmark.
                // Dark mode: no filter → original white.
                "brightness-0 dark:brightness-100",
              )}
            />
          </Link>
          <div className="min-w-0">
            <CampaignSwitcher />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Capacity/timing pills carry the most width — show only on wide screens */}
          <div className="hidden items-center gap-2 lg:flex">
            <PrimeTimePill timezone={staff.timezone ?? "America/Toronto"} />
          </div>
          <NotificationsBell />
          <div className="hidden sm:block">
            <TimezonePicker currentTimezone={staff.timezone ?? "America/Toronto"} />
          </div>
          <ThemeToggle />
          <div className="hidden sm:block">
            <ShortcutsHintButton />
          </div>
          <UserMenu staff={staff} provider={provider} />
        </div>
      </div>
    </header>
  );
}
