"use client";

/**
 * InboxFilterBar — search box + alias picker + "Mine only" toggle that
 * sits above the thread list in the middle pane.
 *
 * Per operator session 11:
 *   - Multi-alias inbox filter: Bryle has 3 aliases (#027); they need
 *     to focus on one at a time.
 *   - Assigned-to-me filter: "show only threads owned by me" — was
 *     URL-supported already (?staff=mine) but had no visible toggle.
 *   - Inbox search: substring match across subject, snippet, venue
 *     name, last-sender name. The most-asked-for feature.
 *
 * Implementation
 * --------------
 * All three filters live in the URL so they survive across thread
 * picks + refresh + share-the-link. Submitting the search triggers a
 * router.push() with the merged params. Tabbing through alias /
 * "mine" doesn't auto-submit — we wait for a user gesture so the page
 * doesn't re-render on every keystroke.
 *
 * The form preserves the existing folder, campaign, brand chips so
 * those filters don't get nuked when the operator searches.
 */

import { cn } from "@/lib/cn";
import { Search, User, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

interface AliasOption {
  id: string;
  emailAddress: string;
  staffDisplayName: string | null;
}

interface Props {
  aliases: AliasOption[];
  currentStaffId: string;
  mineOnly: boolean;
  activeAliasId?: string;
  initialSearch?: string;
}

export function InboxFilterBar({
  aliases,
  currentStaffId,
  mineOnly,
  activeAliasId,
  initialSearch,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(initialSearch ?? "");

  function buildNextUrl(overrides: Record<string, string | null>): string {
    // Start from the current params so we don't lose folder/campaign/brand.
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(buildNextUrl({ q: search.trim() || null }));
  }

  function setMine(next: boolean) {
    router.push(buildNextUrl({ staff: next ? currentStaffId : null }));
  }

  function setAlias(next: string) {
    router.push(buildNextUrl({ alias: next === "_all" ? null : next }));
  }

  return (
    <form
      onSubmit={submitSearch}
      className={cn(
        "flex flex-col gap-2 border-zinc-200/80 border-b bg-zinc-50/40 px-3 py-2.5",
        "dark:border-zinc-800/60 dark:bg-zinc-900/30",
      )}
    >
      {/* Row 1: search input */}
      <div className="relative">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 h-3 w-3 text-zinc-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search threads, subjects, venues…"
          aria-label="Search inbox"
          className={cn(
            "w-full rounded-md border border-zinc-200 bg-white py-1 pr-8 pl-7 text-xs",
            "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
            "dark:border-zinc-700 dark:bg-zinc-900",
          )}
        />
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              router.push(buildNextUrl({ q: null }));
            }}
            className="-translate-y-1/2 absolute top-1/2 right-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Row 2: mine toggle + alias select */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMine(!mineOnly)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium text-[11px] transition-colors",
            mineOnly
              ? "border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-100"
              : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
          )}
          aria-pressed={mineOnly}
        >
          <User className="h-3 w-3" />
          Mine
        </button>

        {aliases.length > 1 && (
          <select
            value={activeAliasId ?? "_all"}
            onChange={(e) => setAlias(e.target.value)}
            aria-label="Filter by alias"
            className={cn(
              "max-w-[200px] flex-1 truncate rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px]",
              "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
              "dark:border-zinc-700 dark:bg-zinc-900",
            )}
          >
            <option value="_all">All inboxes</option>
            {aliases.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emailAddress}
                {a.staffDisplayName && ` (${a.staffDisplayName})`}
              </option>
            ))}
          </select>
        )}

        {/* Submit-on-Enter is implicit; render a small visible cue so the
            user knows pressing Enter in the search input submits. */}
        <button
          type="submit"
          className="ml-auto font-mono text-[9px] text-zinc-400 uppercase tracking-widest hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          search
        </button>
      </div>
    </form>
  );
}
