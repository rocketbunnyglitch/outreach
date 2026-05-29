"use client";

/**
 * SideNav — Sheets-style left rail with grouped sections + active-route
 * highlight. Replaces the old 18-item horizontal nav.
 *
 * Grouping decisions:
 *   • Inbox + Tasks: 'Today' — what you live in
 *   • All Crawls → Maps: 'Operate' — daily campaign work
 *   • Cities → Templates: 'Data' — operational data setup
 *   • Brands + Campaigns + Hosts: 'Settings' — campaign configuration
 *   • Goals: under 'Admin' (admin-only — it's a management view)
 *   • Admin → Audit: admin-only, gated below
 *
 * Off-nav entry points (operator session-12 P2 declutter):
 *   • Email connection lives behind a gear on /inbox (its natural home)
 *   • CSV import lives behind a button on /venues
 *
 * Active route: highlighted with a left accent bar in the staffer's
 * brand color. The current section's group label is also tinted so
 * the user always knows where they are in the structure.
 *
 * Collapse: the rail is fixed 200px wide; on narrow viewports (<lg)
 * we hide it and rely on MobileSectionNav. Phase 16 could add a
 * collapse-to-icons mode for power users; not in v1.
 */

import { cn } from "@/lib/cn";
import {
  Activity,
  Archive,
  BarChart3,
  Boxes,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  ChevronDown,
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
import { type ReactNode, useEffect, useState } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const SECTIONS: Array<{
  label: string;
  items: NavItem[];
}> = [
  {
    label: "Current Crawl",
    items: [
      { href: "/", label: "Dashboard", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
      { href: "/tracker", label: "Tracker", icon: <Table2 className="h-3.5 w-3.5" /> },
      { href: "/inbox", label: "Inbox", icon: <Inbox className="h-3.5 w-3.5" /> },
      { href: "/tasks", label: "Tasks", icon: <CheckSquare className="h-3.5 w-3.5" /> },
      // Calendar lives here (alongside Maps) per operator: both are
      // "where + when this campaign is happening" views, not
      // operational queues. Used to live in Operate.
      { href: "/calendar", label: "Calendar", icon: <Calendar className="h-3.5 w-3.5" /> },
      { href: "/maps", label: "Maps", icon: <Globe2 className="h-3.5 w-3.5" /> },
    ],
  },
  {
    label: "Operate",
    // Order per operator spec — top to bottom matches the rough
    // flow of running the campaign:
    //   logistics (all crawls / matrix / wristbands) →
    //   hosts (internal / external) →
    //   outbound (send queue / event submission) →
    //   support (crawl support / support hours)
    items: [
      { href: "/all-crawls", label: "All Crawls", icon: <MapIcon className="h-3.5 w-3.5" /> },
      { href: "/crawl-matrix", label: "Crawl Matrix", icon: <Boxes className="h-3.5 w-3.5" /> },
      { href: "/wristbands", label: "Wristbands", icon: <Tag className="h-3.5 w-3.5" /> },
      {
        href: "/internal-hosts",
        label: "Internal Hosts",
        icon: <Users className="h-3.5 w-3.5" />,
      },
      {
        href: "/external-hosts",
        label: "External Hosts",
        icon: <Users className="h-3.5 w-3.5" />,
      },
      { href: "/send-queue", label: "Send Queue", icon: <Send className="h-3.5 w-3.5" /> },
      {
        href: "/event-submission",
        label: "Event Submission",
        icon: <Upload className="h-3.5 w-3.5" />,
      },
      {
        href: "/crawl-support",
        label: "Crawl Support",
        icon: <LifeBuoy className="h-3.5 w-3.5" />,
      },
      { href: "/support-hours", label: "Support Hours", icon: <Clock className="h-3.5 w-3.5" /> },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/cities", label: "Cities", icon: <Globe className="h-3.5 w-3.5" /> },
      { href: "/venues", label: "Venues", icon: <Building2 className="h-3.5 w-3.5" /> },
      { href: "/templates", label: "Templates", icon: <FileCode className="h-3.5 w-3.5" /> },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/brands", label: "Brands", icon: <Briefcase className="h-3.5 w-3.5" /> },
      { href: "/campaigns", label: "Campaigns", icon: <Target className="h-3.5 w-3.5" /> },
    ],
  },
];

const ADMIN_SECTION: { label: string; items: NavItem[] } = {
  label: "Admin",
  items: [
    { href: "/admin", label: "Admin", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    { href: "/goals", label: "Goals", icon: <Target className="h-3.5 w-3.5" /> },
    { href: "/admin/analytics", label: "Analytics", icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { href: "/audit", label: "Audit", icon: <Archive className="h-3.5 w-3.5" /> },
  ],
};

export function SideNav({
  isAdmin,
  hasCurrentCampaign,
}: {
  isAdmin: boolean;
  /** True when a specific campaign is scoped (not "all"). When false,
   *  Current Crawl + Operate are hidden entirely — the operator needs
   *  to pick a campaign first. Also defaults the Admin group to
   *  collapsed when a campaign IS scoped (admin views are usually
   *  noise inside a campaign). */
  hasCurrentCampaign: boolean;
}) {
  const pathname = usePathname();
  // Without a campaign, the campaign-scoped sections (Current Crawl,
  // Operate) are hidden from the nav. The pages themselves redirect to
  // /admin via the middleware, so the user can't reach them by URL
  // either. Data, Settings, and Admin remain available.
  const visibleSections = hasCurrentCampaign
    ? SECTIONS
    : SECTIONS.filter((s) => s.label !== "Current Crawl" && s.label !== "Operate");
  const sections = isAdmin ? [...visibleSections, ADMIN_SECTION] : visibleSections;

  // Active match: exact `/`, otherwise prefix match. So /venues/abc-123
  // highlights "Venues".
  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // Collapse state for the two collapsible groups.
  //
  // Both Admin and Settings default to collapsed — they're config
  // surfaces operators rarely visit during day-to-day work, so they
  // shouldn't add noise to the nav. The user's click is persisted
  // in localStorage per-group so we don't fight them on every page
  // change.
  //
  // Exception: if the user is currently ON a route inside one of
  // these groups, the group is force-expanded so the active item
  // is reachable; the chevron still toggles the persisted state
  // (so when they navigate away, the user's preference resumes).
  const [adminExpanded, setAdminExpanded] = useState<boolean>(!hasCurrentCampaign);
  const [settingsExpanded, setSettingsExpanded] = useState<boolean>(false);
  useEffect(() => {
    try {
      const adminStored = window.localStorage.getItem("sidenav.adminExpanded");
      if (adminStored === "1") setAdminExpanded(true);
      else if (adminStored === "0") setAdminExpanded(false);

      const settingsStored = window.localStorage.getItem("sidenav.settingsExpanded");
      if (settingsStored === "1") setSettingsExpanded(true);
      else if (settingsStored === "0") setSettingsExpanded(false);
    } catch {
      /* ignore — storage may be unavailable */
    }
  }, []);

  const onAdminRoute = ADMIN_SECTION.items.some((i) => isActive(i.href));
  const effectiveAdminExpanded = onAdminRoute || adminExpanded;

  const settingsSection = sections.find((s) => s.label === "Settings");
  const onSettingsRoute = settingsSection
    ? settingsSection.items.some((i) => isActive(i.href))
    : false;
  const effectiveSettingsExpanded = onSettingsRoute || settingsExpanded;

  function toggleAdmin() {
    const next = !adminExpanded;
    setAdminExpanded(next);
    try {
      window.localStorage.setItem("sidenav.adminExpanded", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function toggleSettings() {
    const next = !settingsExpanded;
    setSettingsExpanded(next);
    try {
      window.localStorage.setItem("sidenav.settingsExpanded", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  return (
    <aside
      className={cn(
        // Pin under the sticky 3.5rem top bar (top-14). Without `sticky`
        // the rail sat in normal flow, so on long pages it scrolled up
        // and out of view and its bottom items (e.g. Audit) clipped.
        // overflow-y-auto then only scrolls the rail itself in the rare
        // case the item list is taller than the viewport.
        "hidden h-[calc(100vh-3.5rem)] w-[200px] shrink-0 self-start overflow-y-auto",
        "sticky top-14",
        "border-zinc-200/80 border-r bg-zinc-50/40 dark:border-zinc-800/60 dark:bg-zinc-950/40",
        "lg:block",
      )}
      aria-label="Primary navigation"
    >
      <nav className="flex flex-col gap-5 px-3 py-5">
        {sections.map((section) => {
          // Two collapsible groups: Admin and Settings. Both default to
          // collapsed; users can toggle via the chevron and we persist
          // their choice in localStorage.
          const isAdminGroup = section.label === "Admin";
          const isSettingsGroup = section.label === "Settings";
          const collapsible = isAdminGroup || isSettingsGroup;
          const expanded = isAdminGroup
            ? effectiveAdminExpanded
            : isSettingsGroup
              ? effectiveSettingsExpanded
              : true;
          const onToggle = isAdminGroup
            ? toggleAdmin
            : isSettingsGroup
              ? toggleSettings
              : undefined;
          return (
            <div key={section.label} className="flex flex-col gap-1">
              {collapsible ? (
                <button
                  type="button"
                  onClick={onToggle}
                  aria-expanded={expanded}
                  className="flex items-center justify-between gap-1 rounded px-2 py-0.5 text-left font-mono text-[9px] text-zinc-400 uppercase tracking-[0.16em] hover:bg-zinc-200/40 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800/40 dark:hover:text-zinc-400"
                >
                  <span>{section.label}</span>
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform duration-150",
                      !expanded && "-rotate-90",
                    )}
                  />
                </button>
              ) : (
                <p className="px-2 font-mono text-[9px] text-zinc-400 uppercase tracking-[0.16em] dark:text-zinc-600">
                  {section.label}
                </p>
              )}
              {expanded && (
                <ul className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
                            active
                              ? "bg-zinc-900 font-medium text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                              : "text-zinc-700 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100",
                          )}
                        >
                          <span
                            className={cn(
                              "shrink-0",
                              active
                                ? "text-zinc-50 dark:text-zinc-900"
                                : "text-zinc-400 dark:text-zinc-600",
                            )}
                          >
                            {item.icon}
                          </span>
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

// Activity icon reserved for the live presence badge (not used directly here).
void Activity;
