"use client";

/**
 * SideNav — Sheets-style left rail with grouped sections + active-route
 * highlight. Replaces the old 18-item horizontal nav.
 *
 * Grouping decisions:
 *   • Inbox + Tasks: 'Today' — what you live in
 *   • All Crawls → Discover: 'Operate' — daily campaign work
 *   • Cities → Templates: 'Data' — operational data setup
 *   • Brands + Campaigns + Goals: 'Settings' — campaign configuration
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
  Clock,
  Compass,
  FileCode,
  Globe,
  Inbox,
  LayoutGrid,
  Map as MapIcon,
  Send,
  ShieldCheck,
  Tag,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
    label: "Today",
    items: [
      { href: "/", label: "Dashboard", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
      { href: "/inbox", label: "Inbox", icon: <Inbox className="h-3.5 w-3.5" /> },
      { href: "/tasks", label: "Tasks", icon: <CheckSquare className="h-3.5 w-3.5" /> },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/all-crawls", label: "All Crawls", icon: <MapIcon className="h-3.5 w-3.5" /> },
      { href: "/crawl-matrix", label: "Crawl Matrix", icon: <Boxes className="h-3.5 w-3.5" /> },
      { href: "/calendar", label: "Calendar", icon: <Calendar className="h-3.5 w-3.5" /> },
      { href: "/send-queue", label: "Send Queue", icon: <Send className="h-3.5 w-3.5" /> },
      { href: "/wristbands", label: "Wristbands", icon: <Tag className="h-3.5 w-3.5" /> },
      { href: "/support-hours", label: "Support Hours", icon: <Clock className="h-3.5 w-3.5" /> },
      { href: "/discover", label: "Discover", icon: <Compass className="h-3.5 w-3.5" /> },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/cities", label: "Cities", icon: <Globe className="h-3.5 w-3.5" /> },
      { href: "/venues", label: "Venues", icon: <Building2 className="h-3.5 w-3.5" /> },
      { href: "/cluster-builder", label: "Clusters", icon: <Boxes className="h-3.5 w-3.5" /> },
      { href: "/middle-groups", label: "Middles", icon: <Users className="h-3.5 w-3.5" /> },
      { href: "/templates", label: "Templates", icon: <FileCode className="h-3.5 w-3.5" /> },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/brands", label: "Brands", icon: <Briefcase className="h-3.5 w-3.5" /> },
      { href: "/campaigns", label: "Campaigns", icon: <Target className="h-3.5 w-3.5" /> },
      { href: "/goals", label: "Goals", icon: <Target className="h-3.5 w-3.5" /> },
      { href: "/internal-hosts", label: "Internal Hosts", icon: <Users className="h-3.5 w-3.5" /> },
      { href: "/external-hosts", label: "External Hosts", icon: <Users className="h-3.5 w-3.5" /> },
    ],
  },
];

const ADMIN_SECTION: { label: string; items: NavItem[] } = {
  label: "Admin",
  items: [
    { href: "/admin", label: "Admin", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    { href: "/admin/analytics", label: "Analytics", icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { href: "/audit", label: "Audit", icon: <Archive className="h-3.5 w-3.5" /> },
  ],
};

export function SideNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const sections = isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;

  // Active match: exact `/`, otherwise prefix match. So /venues/abc-123
  // highlights "Venues".
  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside
      className={cn(
        "hidden h-[calc(100vh-3.5rem)] w-[200px] shrink-0 overflow-y-auto",
        "border-zinc-200/80 border-r bg-zinc-50/40 dark:border-zinc-800/60 dark:bg-zinc-950/40",
        "lg:block",
      )}
      aria-label="Primary navigation"
    >
      <nav className="flex flex-col gap-5 px-3 py-5">
        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            <p className="px-2 font-mono text-[9px] text-zinc-400 uppercase tracking-[0.16em] dark:text-zinc-600">
              {section.label}
            </p>
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
          </div>
        ))}
      </nav>
    </aside>
  );
}

// Activity icon reserved for the live presence badge (not used directly here).
void Activity;
