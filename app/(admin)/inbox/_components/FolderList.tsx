import { cn } from "@/lib/cn";
import { FOLDER_LABELS, INBOX_FOLDERS, type InboxFolder } from "@/lib/inbox-data";
import type { InboxFilterFacets } from "@/lib/inbox-data";
import {
  CheckCheck,
  CheckCircle2,
  Clock4,
  Inbox as InboxIcon,
  MailOpen,
  RotateCcw,
  Settings,
  Tag,
  X,
} from "lucide-react";
import Link from "next/link";

/**
 * Five canonical folders. Anything else (campaign / brand / staff) becomes
 * a filter chip below the folders — see CLAUDE design rationale: 13 folders
 * is decision fatigue dressed as power-user.
 */
const FOLDER_ICONS: Record<InboxFolder, React.ReactNode> = {
  needs_reply: <InboxIcon className="h-4 w-4" />,
  waiting: <Clock4 className="h-4 w-4" />,
  follow_up: <RotateCcw className="h-4 w-4" />,
  closed: <CheckCircle2 className="h-4 w-4" />,
  all: <MailOpen className="h-4 w-4" />,
};

export function FolderList({
  activeFolder,
  counts,
  mineOnly,
  currentStaffId,
  facets,
  activeBrandId,
  activeCampaignId,
  preservedQueryBase,
}: {
  activeFolder: InboxFolder;
  counts: Record<InboxFolder, number>;
  mineOnly: boolean;
  currentStaffId: string;
  /** Active brand + campaign facets with open-thread counts. */
  facets?: InboxFilterFacets;
  /** Currently-applied brand filter (URL param). */
  activeBrandId?: string;
  /** Currently-applied campaign filter (URL param). */
  activeCampaignId?: string;
  /** Other URL params to preserve when building chip hrefs. */
  preservedQueryBase?: string;
}) {
  return (
    <nav aria-label="Inbox folders" className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-2 px-2">
        <div>
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Operations
          </p>
          <h2 className="mt-0.5 font-semibold text-lg tracking-tight">Inbox</h2>
        </div>
        {/* Email connection settings — moved off the left nav (session-12
            P2 declutter) to a gear here, where email config naturally
            belongs. Links to the inbox/OAuth setup page. */}
        <Link
          href="/settings/inboxes"
          title="Email settings — connect & manage inboxes"
          aria-label="Email settings"
          className="mt-0.5 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </header>

      <ul className="flex flex-col gap-0.5">
        {INBOX_FOLDERS.map((folder) => {
          const isActive = folder === activeFolder;
          const count = counts[folder] ?? 0;
          const params = new URLSearchParams();
          params.set("folder", folder);
          if (mineOnly) params.set("staff", currentStaffId);
          return (
            <li key={folder}>
              <Link
                href={`/inbox?${params.toString()}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900",
                )}
              >
                <span
                  className={cn(
                    "shrink-0",
                    isActive
                      ? "text-zinc-200 dark:text-zinc-700"
                      : "text-zinc-500 dark:text-zinc-400",
                  )}
                >
                  {FOLDER_ICONS[folder]}
                </span>
                <span className="flex-1 truncate">{FOLDER_LABELS[folder]}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] tabular-nums",
                      isActive
                        ? "text-zinc-300 dark:text-zinc-700"
                        : "text-zinc-500 dark:text-zinc-500",
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-zinc-200/80 border-t pt-3 dark:border-zinc-800/60">
        <p className="px-2 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Filters
        </p>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          <li>
            <ChipLink
              href={
                mineOnly
                  ? `/inbox?folder=${activeFolder}`
                  : `/inbox?folder=${activeFolder}&staff=${currentStaffId}`
              }
              active={mineOnly}
              icon={<CheckCheck className="h-3.5 w-3.5" />}
            >
              Mine only
            </ChipLink>
          </li>
          {/* Brand + campaign chips — facets are scoped to threads
              with at least one open conversation, so a dead brand
              with 0 unread threads doesn't waste a row. Up to
              MAX_CHIPS per group; overflow falls into a "+N more"
              link to the full filter modal (TODO, not yet built;
              the operator can use URL params directly meanwhile). */}
          {facets?.brands && facets.brands.length > 0 && (
            <>
              <li className="mt-2 px-2 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
                Brand
              </li>
              {facets.brands.slice(0, 6).map((f) => (
                <li key={f.id}>
                  <FilterChip
                    href={buildChipHref({
                      activeFolder,
                      preservedQueryBase,
                      brandId: activeBrandId === f.id ? undefined : f.id,
                      campaignId: activeCampaignId,
                    })}
                    active={activeBrandId === f.id}
                    icon={<Tag className="h-3 w-3" />}
                    count={f.count}
                  >
                    {f.label}
                  </FilterChip>
                </li>
              ))}
            </>
          )}
          {facets?.campaigns && facets.campaigns.length > 0 && (
            <>
              <li className="mt-2 px-2 font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
                Campaign
              </li>
              {facets.campaigns.slice(0, 8).map((f) => (
                <li key={f.id}>
                  <FilterChip
                    href={buildChipHref({
                      activeFolder,
                      preservedQueryBase,
                      brandId: activeBrandId,
                      campaignId: activeCampaignId === f.id ? undefined : f.id,
                    })}
                    active={activeCampaignId === f.id}
                    icon={<Tag className="h-3 w-3" />}
                    count={f.count}
                  >
                    {f.label}
                  </FilterChip>
                </li>
              ))}
            </>
          )}
          {(activeBrandId || activeCampaignId) && (
            <li className="mt-2">
              <Link
                href={`/inbox?folder=${activeFolder}${mineOnly ? `&staff=${currentStaffId}` : ""}`}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <X className="h-2.5 w-2.5" />
                Clear filters
              </Link>
            </li>
          )}
        </ul>
      </div>
    </nav>
  );
}

function ChipLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
        active
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
      )}
    >
      <span className="shrink-0 text-zinc-500">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
    </Link>
  );
}

/**
 * Filter chip with a count badge. Visually similar to ChipLink but
 * carries a right-aligned count of matching open threads. Active
 * state uses a contrast pill since chip "active" means "filter
 * applied" (clicking again unsets it).
 */
function FilterChip({
  href,
  active,
  icon,
  count,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
        active
          ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
      )}
    >
      <span
        className={cn("shrink-0", active ? "text-zinc-200 dark:text-zinc-700" : "text-zinc-500")}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{children}</span>
      {count > 0 && (
        <span
          className={cn(
            "shrink-0 font-mono text-[10px] tabular-nums",
            active ? "text-zinc-300 dark:text-zinc-700" : "text-zinc-500",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

/**
 * Build a /inbox URL with the given folder + filters. Toggling a
 * chip works by passing undefined for the active id, which removes
 * the param. Other preserved params (mine, staff, search) come in
 * via preservedQueryBase so the existing scope is maintained.
 */
function buildChipHref(opts: {
  activeFolder: InboxFolder;
  preservedQueryBase?: string;
  brandId?: string;
  campaignId?: string;
}): string {
  const params = new URLSearchParams(opts.preservedQueryBase ?? "");
  params.set("folder", opts.activeFolder);
  if (opts.brandId) {
    params.set("brand", opts.brandId);
  } else {
    params.delete("brand");
  }
  if (opts.campaignId) {
    params.set("campaign", opts.campaignId);
  } else {
    params.delete("campaign");
  }
  return `/inbox?${params.toString()}`;
}
