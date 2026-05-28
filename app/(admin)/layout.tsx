import { ShortcutProvider } from "@/components/ui/shortcut-provider";
import { StaleDataIndicator } from "@/components/ui/stale-data-indicator";
import { ToastProvider } from "@/components/ui/toast";
import { requireStaff } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { getStaffSendCapStatus } from "@/lib/send-cap-status";
import { ShieldAlert } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { CampaignSwitcher } from "./_components/campaign-switcher";
import { GlobalShortcuts } from "./_components/global-shortcuts";
import { MobileSectionNav } from "./_components/mobile-section-nav";
import { MountCommandPalette } from "./_components/mount-command-palette";
import { NotificationsBell } from "./_components/notifications-bell";
import { PrimeTimePill } from "./_components/prime-time-pill";
import { SendCapPill } from "./_components/send-cap-pill";
import { ShortcutsHintButton } from "./_components/shortcuts-hint-button";
import { SideNav } from "./_components/side-nav";
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
  // Fetch send cap status server-side so the pill renders at SSR time
  // and stays in sync with the throttle. Cheap query (~5ms typical).
  const sendCap = await getStaffSendCapStatus(staff.id);

  return (
    <ToastProvider>
      <ShortcutProvider>
        <div className="flex min-h-screen flex-col">
          {isDevImpersonation && <DevModeBanner />}
          <TopBar staff={staff} provider={provider} sendCap={sendCap} />
          {/* Mobile-only horizontal section + sub-nav strips. Renders
              under the TopBar at < lg viewports; hidden at lg+ where
              SideNav takes over. Replaces the old hamburger drawer
              (operator session 11). */}
          <MobileSectionNav isAdmin={staff.role === "admin"} />
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
  sendCap,
}: {
  staff: Awaited<ReturnType<typeof requireStaff>>["staff"];
  provider: string;
  sendCap: Awaited<ReturnType<typeof getStaffSendCapStatus>>;
}) {
  return (
    <header className="sticky top-0 z-40 border-zinc-200 border-b bg-[color:var(--color-canvas)]/85 backdrop-blur-md dark:border-zinc-800 dark:bg-[color:var(--color-canvas-dark)]/85">
      <div className="flex h-14 w-full items-center justify-between gap-4 px-6 sm:px-10">
        <div className="flex items-center gap-6">
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
                "h-3.5 w-auto select-none",
                // Light mode: brightness(0) zeroes RGB → black wordmark.
                // Dark mode: no filter → original white.
                "brightness-0 dark:brightness-100",
              )}
            />
          </Link>
          <CampaignSwitcher />
        </div>
        <div className="flex items-center gap-2">
          <PrimeTimePill timezone={staff.timezone ?? "America/Toronto"} />
          <SendCapPill
            inboxes={sendCap.inboxes}
            totalSent={sendCap.totalSent24h}
            totalCap={sendCap.totalCap}
            allMaxed={sendCap.allMaxed}
          />
          <NotificationsBell />
          <TimezonePicker currentTimezone={staff.timezone ?? "America/Toronto"} />
          <ThemeToggle />
          <ShortcutsHintButton />
          <UserMenu staff={staff} provider={provider} />
        </div>
      </div>
    </header>
  );
}
