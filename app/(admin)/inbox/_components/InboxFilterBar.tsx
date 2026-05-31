"use client";

/**
 * InboxFilterBar — search box + alias picker + "Mine assigned" /
 * "Mine inbox" toggles + submit cue.
 *
 * Two distinct "mine" filters:
 *   - "Mine assigned" (?staff=<id>) — threads ASSIGNED TO ME (the
 *     person triaging the thread). A thread can be in anyone's inbox
 *     but assigned to me to follow up.
 *   - "Mine inbox" (?mine=1) — threads flowing through MY connected
 *     Gmail accounts. The new team-shared inbox shows every team
 *     account by default; this toggle narrows to my own.
 *
 * Plus alias filter to pin to one specific Gmail account, and
 * substring search across subject/snippet/venue/sender. All three
 * filters live in the URL.
 */

import { cn } from "@/lib/cn";
import type { SavedSearch } from "@/lib/inbox-saved-searches";
import { parseSearchQuery } from "@/lib/inbox-search";
import { Inbox, Search, User, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { InboxDensityToggle } from "./InboxDensityToggle";
import { SavedSearchesDropdown } from "./SavedSearchesDropdown";

interface AliasOption {
  id: string;
  emailAddress: string;
  staffDisplayName: string | null;
}

interface Props {
  aliases: AliasOption[];
  currentStaffId: string;
  /** "Assigned to me" filter (?staff=<currentId>). */
  mineAssigned: boolean;
  /** "Owned by me" inbox filter (?mine=1). */
  mineInbox: boolean;
  activeAliasId?: string;
  initialSearch?: string;
  /** Saved searches for the current operator (Phase B.2). */
  savedSearches?: SavedSearch[];
}

export function InboxFilterBar({
  aliases,
  currentStaffId,
  mineAssigned,
  mineInbox,
  activeAliasId,
  initialSearch,
  savedSearches = [],
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(initialSearch ?? "");

  function buildNextUrl(overrides: Record<string, string | null>): string {
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

  function setMineAssigned(next: boolean) {
    router.push(buildNextUrl({ staff: next ? currentStaffId : null }));
  }

  function setMineInbox(next: boolean) {
    router.push(buildNextUrl({ mine: next ? "1" : null }));
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
      {/* Row 1: search input + saved searches */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 h-3 w-3 text-zinc-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search subjects + bodies · try from: subject: is:unread "exact phrase"'
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
        <SavedSearchesDropdown
          saved={savedSearches}
          currentQuery={search}
          onApply={(q) => {
            setSearch(q);
            router.push(buildNextUrl({ q: q.trim() || null }));
          }}
        />
      </div>
      {/* Parsed-operator hint chips. Shown only when the active query
          contains at least one recognized operator, so plain free-text
          searches don't get a redundant repeat below the input. */}
      <ParsedOperatorChips raw={search} />

      {/* Row 2: mine-assigned + mine-inbox toggles + alias select.
          Scrolls horizontally on mobile to avoid wrapping when the
          alias picker label is long. */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setMineInbox(!mineInbox)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1.5 font-medium text-[11px] transition-colors sm:py-0.5",
            mineInbox
              ? "border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-100"
              : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
          )}
          aria-pressed={mineInbox}
          title={
            mineInbox
              ? "Showing only threads in YOUR connected inboxes"
              : "Showing every team inbox"
          }
        >
          <Inbox className="h-3 w-3" />
          My inbox
        </button>

        <button
          type="button"
          onClick={() => setMineAssigned(!mineAssigned)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1.5 font-medium text-[11px] transition-colors sm:py-0.5",
            mineAssigned
              ? "border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-100"
              : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
          )}
          aria-pressed={mineAssigned}
          title="Threads assigned to me"
        >
          <User className="h-3 w-3" />
          Assigned to me
        </button>

        {aliases.length > 1 && (
          <select
            value={activeAliasId ?? "_all"}
            onChange={(e) => setAlias(e.target.value)}
            aria-label="Filter by alias"
            className={cn(
              "max-w-[200px] flex-1 truncate rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-[11px] sm:py-0.5",
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
        <InboxDensityToggle />
      </div>
    </form>
  );
}

/**
 * ParsedOperatorChips — visual feedback on the search parser so
 * operators can see how their query maps to filters. Renders only
 * when at least one recognized operator is present; pure free-text
 * searches don't show anything (the input itself is the feedback).
 */
function ParsedOperatorChips({ raw }: { raw: string }) {
  const parsed = parseSearchQuery(raw);
  const chips: Array<{ label: string; value: string }> = [];
  if (parsed.from) chips.push({ label: "from", value: parsed.from });
  if (parsed.to) chips.push({ label: "to", value: parsed.to });
  if (parsed.subject) chips.push({ label: "subject", value: parsed.subject });
  if (parsed.label) chips.push({ label: "label", value: parsed.label });
  if (parsed.hasAttachment) chips.push({ label: "has", value: "attachment" });
  if (parsed.isUnread) chips.push({ label: "is", value: "unread" });
  if (parsed.isStarred) chips.push({ label: "is", value: "starred" });
  if (parsed.isSnoozed) chips.push({ label: "is", value: "snoozed" });
  if (parsed.isTrashed) chips.push({ label: "is", value: "trashed" });
  if (parsed.before) chips.push({ label: "before", value: parsed.before });
  if (parsed.after) chips.push({ label: "after", value: parsed.after });
  if (parsed.campaignId) chips.push({ label: "campaign", value: parsed.campaignId.slice(0, 8) });
  if (parsed.brandId) chips.push({ label: "brand", value: parsed.brandId.slice(0, 8) });
  if (parsed.venueId) chips.push({ label: "venue", value: parsed.venueId.slice(0, 8) });
  if (parsed.assignedStaffId) {
    chips.push({ label: "assigned", value: parsed.assignedStaffId.slice(0, 8) });
  }
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 px-0.5">
      {chips.map((c) => (
        <span
          key={`${c.label}:${c.value}`}
          className="inline-flex items-center gap-0.5 rounded-md bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
          title={`Active operator: ${c.label}:${c.value}`}
        >
          <span className="font-medium">{c.label}:</span>
          <span className="truncate">{c.value}</span>
        </span>
      ))}
      {parsed.freeText && (
        <span
          className="inline-flex items-center gap-0.5 rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          title="Free-text portion of the query"
        >
          <span className="font-medium">text:</span>
          <span className="truncate">{parsed.freeText}</span>
        </span>
      )}
    </div>
  );
}
