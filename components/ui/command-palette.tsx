"use client";

import { cn } from "@/lib/cn";
import {
  ArrowRight,
  Building2,
  Calendar,
  CheckSquare,
  ChevronRight,
  Command,
  Loader2,
  Mail,
  MapPin,
  PartyPopper,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShortcut } from "./shortcut-provider";

/**
 * Cmd+K command palette.
 *
 * Three layers of results, in order:
 *   1. Static actions (navigation, common tasks) — always available,
 *      fast match
 *   2. Live search results from the server (venues, cities, campaigns,
 *      staff) — debounced 200ms after typing stops
 *   3. Recent items (last visited venues/campaigns) — TODO follow-up
 *
 * Open via Cmd+K or '/'. Type to filter. Arrow keys to navigate.
 * Enter to fire. Esc to close.
 *
 * The palette is the universal "where do I go / what do I do" surface
 * — matches every modern productivity app.
 */

export interface PaletteItem {
  id: string;
  /** Primary display text */
  label: string;
  /** Optional secondary line shown below (e.g. address, city) */
  description?: string;
  /** Group header in the result list */
  group: string;
  /** Icon component */
  icon?: React.ComponentType<{ className?: string }>;
  /** What to do when selected */
  action: () => void;
  /** Keywords for fuzzy matching beyond label */
  keywords?: string[];
}

interface PaletteSearchResult {
  venues: Array<{ id: string; name: string; cityName: string | null; address: string | null }>;
  cities: Array<{ id: string; name: string; region: string | null }>;
  campaigns: Array<{
    id: string;
    name: string;
    brandName: string;
    isCityCampaign: boolean;
  }>;
  staff: Array<{ id: string; displayName: string; primaryEmail: string }>;
  /** Phase G — email threads matched by subject, snippet, or body. */
  threads: Array<{
    id: string;
    subject: string | null;
    snippet: string | null;
    venueName: string | null;
    lastMessageAt: Date;
  }>;
  /** Phase G — open tasks matched by title or description. */
  tasks: Array<{
    id: string;
    title: string;
    targetType: string;
    targetId: string | null;
    dueAt: Date | null;
  }>;
  /** Phase G — crawl events matched by city or date. */
  events: Array<{
    id: string;
    cityName: string;
    crawlDate: string;
    crawlNumber: number;
    dayPart: string;
  }>;
}

/**
 * Server search action (registered in app/(admin)/_actions/palette-search.ts).
 * Pluggable — see CommandPalette.searchAction prop.
 */
type SearchFn = (query: string) => Promise<PaletteSearchResult>;

export function CommandPalette({
  search,
}: {
  /** Server action that returns search results for the query */
  search: SearchFn;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaletteSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Register Cmd+K + '/' to open
  useShortcut({
    keys: "mod+k",
    label: "Open command palette",
    group: "Navigation",
    handler: () => setOpen(true),
  });
  useShortcut({
    keys: "/",
    label: "Open command palette",
    group: "Navigation",
    handler: () => setOpen(true),
  });

  // Focus input on open, reset state on close
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(null);
      setSelectedIdx(0);
      // Defer focus to next tick so the input has mounted
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced server search
  useEffect(() => {
    if (!open || !query.trim() || query.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const data = await search(query.trim());
        setResults(data);
      } catch {
        setResults(null);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open, search]);

  // Compose the static action items
  const staticItems: PaletteItem[] = useMemo(
    () => [
      // ----- Navigation: daily-use surfaces ---------------------------------
      {
        id: "nav:dashboard",
        label: "Go to Dashboard",
        group: "Navigation",
        icon: ArrowRight,
        action: () => router.push("/"),
        keywords: ["home", "today", "tracker"],
      },
      {
        id: "nav:tracker",
        label: "Open Tracker",
        group: "Navigation",
        icon: Calendar,
        action: () => router.push("/tracker"),
        keywords: ["progress", "cities", "tracker"],
      },
      {
        id: "nav:inbox",
        label: "Open Inbox",
        group: "Navigation",
        icon: Mail,
        action: () => router.push("/inbox"),
        keywords: ["email", "messages", "threads"],
      },
      {
        id: "nav:tasks",
        label: "Open Tasks",
        group: "Navigation",
        icon: CheckSquare,
        action: () => router.push("/tasks"),
        keywords: ["todo", "follow-up", "tasks"],
      },
      {
        id: "nav:campaigns",
        label: "Go to City campaigns",
        group: "Navigation",
        icon: ArrowRight,
        action: () => router.push("/city-campaigns"),
        keywords: ["cities", "outreach"],
      },
      {
        id: "nav:all-crawls",
        label: "Go to All Crawls",
        group: "Navigation",
        icon: Calendar,
        action: () => router.push("/all-crawls"),
        keywords: ["events", "crawls"],
      },
      {
        id: "nav:venues",
        label: "Go to Venues",
        group: "Navigation",
        icon: Building2,
        action: () => router.push("/venues"),
      },
      {
        id: "nav:cities",
        label: "Go to Cities",
        group: "Navigation",
        icon: MapPin,
        action: () => router.push("/cities"),
        keywords: ["directory", "cities"],
      },
      {
        id: "nav:brands",
        label: "Go to Brands",
        group: "Navigation",
        icon: ArrowRight,
        action: () => router.push("/brands"),
      },
      {
        id: "nav:campaign-list",
        label: "Go to Campaigns list",
        group: "Navigation",
        icon: PartyPopper,
        action: () => router.push("/campaigns"),
        keywords: ["holidays", "campaign management"],
      },
      {
        id: "nav:analytics",
        label: "Team analytics",
        group: "Navigation",
        icon: Users,
        action: () => router.push("/admin/analytics"),
        keywords: ["stats", "performance"],
      },

      // ----- Create new ----------------------------------------------------
      {
        id: "new:venue",
        label: "New venue",
        group: "Create",
        icon: Sparkles,
        action: () => router.push("/venues/new"),
        keywords: ["add", "create", "venue"],
      },
      {
        id: "new:city",
        label: "New city",
        group: "Create",
        icon: Sparkles,
        action: () => router.push("/cities/new"),
        keywords: ["add", "create", "city"],
      },
      {
        id: "new:campaign",
        label: "New campaign",
        group: "Create",
        icon: Sparkles,
        action: () => router.push("/campaigns/new"),
        keywords: ["add", "create", "campaign", "holiday"],
      },

      // ----- Admin / Archive surfaces -------------------------------------
      {
        id: "admin:home",
        label: "Admin home",
        group: "Admin",
        icon: ArrowRight,
        action: () => router.push("/admin"),
        keywords: ["admin", "settings"],
      },
      {
        id: "admin:archived-venues",
        label: "Archived venues",
        group: "Admin",
        icon: Building2,
        action: () => router.push("/admin/archived-venues"),
        keywords: ["archive", "restore", "deleted venues"],
      },
      {
        id: "admin:archived-cities",
        label: "Archived cities",
        group: "Admin",
        icon: MapPin,
        action: () => router.push("/admin/archived-cities"),
        keywords: ["archive", "restore", "deleted cities"],
      },
      {
        id: "admin:archived-campaigns",
        label: "Archived campaigns",
        group: "Admin",
        icon: PartyPopper,
        action: () => router.push("/admin/archived-campaigns"),
        keywords: ["archive", "restore", "deleted campaigns"],
      },
      {
        id: "admin:users",
        label: "Staff & users",
        group: "Admin",
        icon: Users,
        action: () => router.push("/admin/users"),
        keywords: ["staff", "team", "users"],
      },
    ],
    [router],
  );

  // Build the live item list — static items + search results
  const items: PaletteItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filteredStatic = q ? staticItems.filter((item) => fuzzyMatch(item, q)) : staticItems;

    const dynamic: PaletteItem[] = [];

    if (results) {
      for (const venue of results.venues) {
        dynamic.push({
          id: `venue:${venue.id}`,
          label: venue.name,
          description: [venue.cityName, venue.address].filter(Boolean).join(" · "),
          group: "Venues",
          icon: Building2,
          action: () => router.push(`/venues/${venue.id}`),
        });
      }
      for (const city of results.cities) {
        dynamic.push({
          id: `city:${city.id}`,
          label: city.name,
          description: city.region ?? undefined,
          group: "Cities",
          icon: MapPin,
          action: () => router.push(`/cities/${city.id}`),
        });
      }
      for (const cc of results.campaigns) {
        dynamic.push({
          id: `cc:${cc.id}`,
          label: cc.name,
          description: cc.brandName,
          group: "Campaigns",
          icon: Calendar,
          action: () =>
            router.push(cc.isCityCampaign ? `/city-campaigns/${cc.id}` : `/campaigns/${cc.id}`),
        });
      }
      for (const s of results.staff) {
        dynamic.push({
          id: `staff:${s.id}`,
          label: s.displayName,
          description: s.primaryEmail,
          group: "Staff",
          icon: Users,
          action: () => router.push(`/admin/analytics/${s.id}`),
        });
      }
      // Phase G — Email threads (subject + body matches).
      for (const t of results.threads) {
        const subject = t.subject ?? "(no subject)";
        const descParts = [
          t.venueName ? t.venueName : null,
          t.snippet ? t.snippet.slice(0, 80) : null,
        ].filter(Boolean);
        dynamic.push({
          id: `thread:${t.id}`,
          label: subject,
          description: descParts.join(" · ") || undefined,
          group: "Email threads",
          icon: Mail,
          action: () => router.push(`/inbox/${t.id}`),
        });
      }
      // Phase G — Open tasks.
      for (const t of results.tasks) {
        const dueLabel = t.dueAt
          ? `due ${new Date(t.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Toronto" })}`
          : "no due date";
        dynamic.push({
          id: `task:${t.id}`,
          label: t.title,
          description: dueLabel,
          group: "Tasks",
          icon: CheckSquare,
          action: () => router.push(`/tasks/${t.id}`),
        });
      }
      // Phase G — Upcoming + recent crawl events.
      for (const e of results.events) {
        const dateLabel = new Date(`${e.crawlDate}T00:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        });
        dynamic.push({
          id: `event:${e.id}`,
          label: `${e.cityName} · crawl ${e.crawlNumber} · ${e.dayPart}`,
          description: dateLabel,
          group: "Events",
          icon: PartyPopper,
          action: () => router.push(`/events/${e.id}`),
        });
      }
    }

    return [...filteredStatic, ...dynamic];
  }, [staticItems, results, query, router]);

  // Reset selection when items list changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit reset on list-length change
  useEffect(() => {
    setSelectedIdx(0);
  }, [items.length]);

  // Keyboard nav inside the palette
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((idx) => Math.min(idx + 1, items.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((idx) => Math.max(idx - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIdx];
        if (item) {
          item.action();
          setOpen(false);
        }
        return;
      }
    },
    [items, selectedIdx],
  );

  // Scroll the selected item into view as the user arrows around
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-palette-idx="${selectedIdx}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdx]);

  if (!open) return null;

  // Group items for visual sections
  const grouped: Array<[string, PaletteItem[], number]> = [];
  {
    let cursor = 0;
    const map = new Map<string, PaletteItem[]>();
    const order: string[] = [];
    for (const item of items) {
      if (!map.has(item.group)) {
        map.set(item.group, []);
        order.push(item.group);
      }
      map.get(item.group)?.push(item);
    }
    for (const group of order) {
      const groupItems = map.get(group) ?? [];
      grouped.push([group, groupItems, cursor]);
      cursor += groupItems.length;
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(false)}
        tabIndex={-1}
        aria-label="Close"
        className="fixed inset-0 z-[150] cursor-default bg-zinc-900/40 backdrop-blur-sm"
      />
      <div className="fixed inset-x-0 top-[10vh] z-[160] grid place-items-start justify-center p-4">
        <div className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          {/* Search input */}
          <div className="flex items-center gap-2 border-zinc-200 border-b px-3 py-2 dark:border-zinc-800">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type to search venues, cities, campaigns, staff…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
              aria-label="Command palette search"
            />
            {searching && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-zinc-400" />}
            <kbd className="hidden shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline-block dark:border-zinc-700">
              esc
            </kbd>
          </div>

          {/* Results — combobox listbox pattern: input above keeps
              focus and drives keyboard nav, the listbox itself is
              announced by screen readers via the label. */}
          {/* biome-ignore lint/a11y/useFocusableInteractive: combobox listbox is announced; input owns focus */}
          <div
            ref={listRef}
            className="max-h-[60vh] overflow-y-auto py-1"
            role="listbox"
            aria-label="Search results"
          >
            {items.length === 0 && (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-zinc-500">
                  {query.trim().length < 2
                    ? "Start typing to search…"
                    : searching
                      ? "Searching…"
                      : "No matches."}
                </p>
                <p className="mt-1 font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em]">
                  {query.trim().length >= 2 && !searching && "Try a different keyword"}
                </p>
              </div>
            )}

            {grouped.map(([group, groupItems, cursor]) => (
              <section key={group} className="py-1">
                <p className="px-3 pt-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
                  {group}
                </p>
                <ul>
                  {groupItems.map((item, i) => {
                    const idx = cursor + i;
                    const isSelected = idx === selectedIdx;
                    const Icon = item.icon ?? Sparkles;
                    return (
                      <PaletteRow
                        key={item.id}
                        idx={idx}
                        selected={isSelected}
                        onClick={() => {
                          item.action();
                          setOpen(false);
                        }}
                        onHover={() => setSelectedIdx(idx)}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                            {item.label}
                          </p>
                          {item.description && (
                            <p className="truncate font-mono text-[10px] text-zinc-500">
                              {item.description}
                            </p>
                          )}
                        </div>
                        {isSelected && <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" />}
                      </PaletteRow>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          {/* Footer hints */}
          <footer className="flex items-center justify-between gap-2 border-zinc-200 border-t px-3 py-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-700">↑↓</kbd>
                navigate
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-700">⏎</kbd>
                select
              </span>
            </div>
            <span className="inline-flex items-center gap-1">
              <Command className="h-2.5 w-2.5" />K to reopen
            </span>
          </footer>
        </div>
      </div>
    </>
  );
}

function PaletteRow({
  selected,
  onClick,
  onHover,
  idx,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  onHover: () => void;
  idx: number;
  children: ReactNode;
}) {
  return (
    <li data-palette-idx={idx} aria-selected={selected}>
      <button
        type="button"
        onClick={onClick}
        onPointerMove={onHover}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
          selected
            ? "bg-blue-500/[0.08] text-zinc-900 dark:bg-blue-400/[0.10] dark:text-zinc-100"
            : "hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40",
        )}
      >
        {children}
      </button>
    </li>
  );
}

/**
 * Token-based fuzzy match: every space-separated token in the query
 * must be a substring of either the label or one of the keywords.
 * Cheap, deterministic, good enough for this scale (dozens of static
 * items + capped server result count).
 */
function fuzzyMatch(item: PaletteItem, query: string): boolean {
  const haystack = [item.label, ...(item.keywords ?? [])].join(" ").toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  return tokens.every((t) => haystack.includes(t));
}
