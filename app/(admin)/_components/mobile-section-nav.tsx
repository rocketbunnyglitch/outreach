"use client";

/**
 * MobileSectionNav — mobile-friendly replacement for the right-drawer
 * hamburger nav (deleted in this commit). Operator session 11:
 *
 *   "The nav on mobile is showing up as a pane on the right that isnt
 *    visible, why is this even a thing, a mobile nav should probably
 *    be a main nav and a sub nav bar at the top the app is not mobile
 *    friendly."
 *
 * Design
 * ------
 * Two horizontally-scrollable strips stacked just under the TopBar:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  TopBar (logo, send-cap, notifications, theme, user)    │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  [Today] [Operate]  Data   Admin   →→→ horizontal scroll│  ← section tabs
 *   ├─────────────────────────────────────────────────────────┤
 *   │  • Dashboard • Inbox • Tasks  →→→ horizontal scroll     │  ← items in the
 *   ├─────────────────────────────────────────────────────────┤    selected section
 *   │  main content                                           │
 *   └─────────────────────────────────────────────────────────┘
 *
 * - Top strip: section tabs (Today / Operate / Data / Admin if admin)
 * - Bottom strip: items in the currently-selected section, with the
 *   active route highlighted
 * - Default selected section: whichever contains the active route.
 *   So opening /venues auto-selects Data and highlights "Venues" in
 *   the sub-strip.
 * - Tap a section to switch the sub-strip; tap an item to navigate
 * - Both strips horizontal-scroll-snap so partial chips don't get
 *   visually clipped
 *
 * Why two strips, not a single one
 * --------------------------------
 * One horizontal strip with all 18+ items requires endless scrolling
 * to find what you want. Two strips give the same info-density as the
 * desktop SideNav grouping but in a mobile-native layout — no drawer
 * to open, no hidden menu.
 *
 * Why not bottom tabs (iOS-style)
 * -------------------------------
 * Bottom tabs work for ≤5 top-level destinations. We have 4 groups
 * (Today / Operate / Data / Admin) AND need item-level nav inside
 * each. Stacking 2 sections of items at the bottom eats half the
 * viewport. Top placement keeps content at the top of viewport.
 *
 * Renders only on screens narrower than lg (where SideNav appears).
 */

import { cn } from "@/lib/cn";
import {
  Archive,
  BarChart3,
  Boxes,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  Clock,
  FileCode,
  Globe,
  Globe2,
  Inbox,
  LayoutGrid,
  LifeBuoy,
  Map as MapIcon,
  Send,
  ShieldCheck,
  Table2,
  Tag,
  Target,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

interface Section {
  label: string;
  items: NavItem[];
}

// Keep this in sync with side-nav.tsx. Both files derive from the
// same canonical grouping. Future refactor: lift into a shared module.
const SECTIONS: Section[] = [
  {
    label: "Current Crawl",
    items: [
      { href: "/", label: "Dashboard", icon: <LayoutGrid className="h-3 w-3" /> },
      { href: "/tracker", label: "Tracker", icon: <Table2 className="h-3 w-3" /> },
      { href: "/inbox", label: "Inbox", icon: <Inbox className="h-3 w-3" /> },
      { href: "/tasks", label: "Tasks", icon: <CheckSquare className="h-3 w-3" /> },
      { href: "/calendar", label: "Calendar", icon: <Calendar className="h-3 w-3" /> },
      { href: "/maps", label: "Maps", icon: <Globe2 className="h-3 w-3" /> },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/all-crawls", label: "All Crawls", icon: <MapIcon className="h-3 w-3" /> },
      { href: "/crawl-matrix", label: "Crawl Matrix", icon: <Boxes className="h-3 w-3" /> },
      { href: "/wristbands", label: "Wristbands", icon: <Tag className="h-3 w-3" /> },
      { href: "/internal-hosts", label: "Internal Hosts", icon: <Users className="h-3 w-3" /> },
      { href: "/external-hosts", label: "External Hosts", icon: <Users className="h-3 w-3" /> },
      { href: "/send-queue", label: "Send Queue", icon: <Send className="h-3 w-3" /> },
      {
        href: "/event-submission",
        label: "Event Submission",
        icon: <Upload className="h-3 w-3" />,
      },
      { href: "/crawl-support", label: "Crawl Support", icon: <LifeBuoy className="h-3 w-3" /> },
      { href: "/support-hours", label: "Support Hours", icon: <Clock className="h-3 w-3" /> },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/cities", label: "Cities", icon: <Globe className="h-3 w-3" /> },
      { href: "/venues", label: "Venues", icon: <Building2 className="h-3 w-3" /> },
      { href: "/templates", label: "Templates", icon: <FileCode className="h-3 w-3" /> },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/brands", label: "Brands", icon: <Briefcase className="h-3 w-3" /> },
      { href: "/campaigns", label: "Campaigns", icon: <Target className="h-3 w-3" /> },
    ],
  },
];

const ADMIN_SECTION: Section = {
  label: "Admin",
  items: [
    { href: "/admin", label: "Admin", icon: <ShieldCheck className="h-3 w-3" /> },
    { href: "/goals", label: "Goals", icon: <Target className="h-3 w-3" /> },
    { href: "/admin/analytics", label: "Analytics", icon: <BarChart3 className="h-3 w-3" /> },
    { href: "/audit", label: "Audit", icon: <Archive className="h-3 w-3" /> },
  ],
};

interface Props {
  isAdmin?: boolean;
  hasCurrentCampaign?: boolean;
}

function isActiveRoute(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Which section contains the active route. Defaults to Today if no match. */
function findActiveSectionIndex(sections: Section[], pathname: string): number {
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!s) continue;
    if (s.items.some((item) => isActiveRoute(item.href, pathname))) return i;
  }
  return 0;
}

export function MobileSectionNav({ isAdmin = false, hasCurrentCampaign = true }: Props) {
  const pathname = usePathname();
  const sections = useMemo(() => {
    // Without a campaign, hide the campaign-scoped sections — mirrors
    // SideNav. The middleware also redirects URLs in those sections to
    // /admin, so a user can't access them directly either.
    const visible = hasCurrentCampaign
      ? SECTIONS
      : SECTIONS.filter((s) => s.label !== "Current Crawl" && s.label !== "Operate");
    return isAdmin ? [...visible, ADMIN_SECTION] : visible;
  }, [isAdmin, hasCurrentCampaign]);

  // The currently-displayed section in the sub-strip. Auto-tracks the
  // route on first paint AND whenever the route changes (so navigating
  // from /venues to /admin reframes the sub-strip).
  const [activeSection, setActiveSection] = useState(() =>
    findActiveSectionIndex(sections, pathname),
  );
  useEffect(() => {
    setActiveSection(findActiveSectionIndex(sections, pathname));
  }, [pathname, sections]);

  const visibleItems = sections[activeSection]?.items ?? [];

  return (
    <nav
      // Renders on screens narrower than lg (SideNav takes over at lg+).
      // Sticky just below the TopBar (which is `top-0 z-40`) so the nav
      // travels with the page on scroll.
      className={cn(
        "sticky top-14 z-30 border-zinc-200 border-b bg-[color:var(--color-canvas)]/85 backdrop-blur-md lg:hidden",
        "dark:border-zinc-800 dark:bg-[color:var(--color-canvas-dark)]/85",
      )}
      aria-label="Mobile navigation"
    >
      {/* Section tabs strip */}
      <div className="scrollbar-thin overflow-x-auto">
        <ul className="flex items-center gap-1 px-3 py-2">
          {sections.map((section, i) => {
            const isCurrent = i === activeSection;
            return (
              <li key={section.label} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveSection(i)}
                  className={cn(
                    "rounded-full px-3 py-1 font-medium text-xs transition-colors",
                    isCurrent
                      ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-800",
                  )}
                  aria-pressed={isCurrent}
                >
                  {section.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Item chips strip */}
      <div className="scrollbar-thin overflow-x-auto border-zinc-200/60 border-t dark:border-zinc-800/60">
        <ul className="flex items-center gap-1 px-3 py-1.5">
          {visibleItems.map((item) => {
            const active = isActiveRoute(item.href, pathname);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-[11px] transition-colors",
                    active
                      ? "bg-blue-500/[0.12] text-blue-700 dark:bg-blue-500/[0.18] dark:text-blue-300"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100",
                  )}
                >
                  <span className={cn(active ? "text-blue-500" : "text-zinc-400")}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
