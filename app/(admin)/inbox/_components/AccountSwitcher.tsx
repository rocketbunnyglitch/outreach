"use client";

/**
 * AccountSwitcher — Gmail-style circular avatar in the top-right
 * of the inbox surface that opens a dropdown of connected accounts.
 *
 * Each row is a checkbox the operator can toggle to scope the inbox
 * to a subset of their connected mailboxes. The selection persists
 * to localStorage immediately so it survives page reloads; a future
 * commit can mirror it to user_preferences for cross-device sync.
 *
 * The filter actually applied to the thread query lives in the URL
 * as ?accounts=<id>,<id>,<id> — this component writes that query
 * param when the operator changes their selection, and Next.js
 * re-fetches the inbox with the narrower scope.
 *
 * Quick actions in the footer (Select all visible, Clear all, My
 * accounts only, Accounts with issues) shortcut the most common
 * filter states without forcing per-row clicks.
 *
 * Avatar trigger: circle with the operator's first initial.
 * Stable color derived from the user id so each operator's avatar
 * is recognizable across devices.
 */

import { cn } from "@/lib/cn";
import type { AccountHealth, VisibleAccount } from "@/lib/visible-accounts";
import { AlertTriangle, Check, RotateCw, ShieldOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveInboxAccountFilter } from "../../_actions/user-preferences";

const STORAGE_KEY = "inbox.accountFilter";

interface Props {
  /** All accounts the operator is allowed to see. Includes their
   *  own plus team accounts (for admins/leads); see
   *  lib/visible-accounts.loadVisibleAccounts. */
  accounts: VisibleAccount[];
  /** The first letter of the operator's name — drives the avatar
   *  glyph. We don't take a full name because the avatar should
   *  always render even when displayName is null. */
  currentUserInitial: string;
  /** Active campaign id, or null when viewing the no-campaign /
   *  all-campaigns mode. Drives the per-campaign persistence key
   *  ("_default" when null) so each campaign keeps its own
   *  visibility scope across sessions. */
  currentCampaignId: string | null;
  /** Server-persisted selection for this campaign (or "_default").
   *  When set, takes precedence over the localStorage fallback —
   *  the URL still wins if it carries an explicit ?accounts. */
  initialSelection: string[] | null;
}

export function AccountSwitcher({
  accounts,
  currentUserInitial,
  currentCampaignId,
  initialSelection,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Resolve selected set from URL first (the persistence layer that
  // actually filters the thread query), then fall back to
  // localStorage on first mount so the operator's last selection
  // survives a hard refresh that didn't carry the param.
  const urlSelected = useMemo(() => {
    const raw = params.get("accounts");
    if (!raw) return null;
    const set = new Set(raw.split(",").filter(Boolean));
    return set;
  }, [params]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (urlSelected) return urlSelected;
    // Server-persisted per-campaign selection wins over localStorage
    // since it survives across devices. localStorage is the local
    // no-flicker fallback for when the server hasn't seeded yet
    // (first-time operator) or the lookup failed.
    if (initialSelection && initialSelection.length > 0) {
      return new Set(initialSelection);
    }
    // Default: every account on first visit.
    //
    // IMPORTANT: do NOT read localStorage here. This initializer runs during
    // SSR (where window is undefined → it returns this default) AND during
    // client hydration (where a populated localStorage would return a saved
    // subset). When those differ, the rendered selection (checkbox states +
    // count label) mismatches between server HTML and client → React #418,
    // and because the inbox renders inside a streaming <Suspense> boundary
    // that can bail the WHOLE page's hydration → frozen inbox. Incognito has
    // empty localStorage so it always matched the default → "works in
    // incognito" only. The saved-selection restore happens post-mount in the
    // effect below, after hydration has completed cleanly.
    return new Set(accounts.map((a) => a.id));
  });

  // Re-sync if the URL changes (e.g. operator picked from another
  // surface).
  useEffect(() => {
    if (urlSelected) setSelectedIds(urlSelected);
  }, [urlSelected]);

  // localStorage fallback — applied AFTER hydration (never during render, see
  // the initializer note above). Runs once on mount; only takes effect when
  // there's no URL selection and no server-seeded selection.
  const lsRestored = useRef(false);
  useEffect(() => {
    if (lsRestored.current) return;
    lsRestored.current = true;
    if (urlSelected || (initialSelection && initialSelection.length > 0)) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setSelectedIds(new Set(parsed as string[]));
      }
    } catch {
      /* ignore */
    }
  }, [urlSelected, initialSelection]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function applySelection(next: Set<string>) {
    setSelectedIds(next);
    // Persist to localStorage immediately for no-flicker reload.
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      /* ignore */
    }
    // Write the URL param so the thread query re-runs with the new
    // scope. Skip the param entirely when every account is selected
    // — keeps URLs short for the default case.
    const url = new URL(window.location.href);
    if (next.size === 0 || next.size === accounts.length) {
      url.searchParams.delete("accounts");
    } else {
      url.searchParams.set("accounts", Array.from(next).join(","));
    }
    router.replace(`${url.pathname}${url.search}`);

    // Persist server-side, keyed by the active campaign (or
    // "_default" when no campaign is selected). Fire-and-forget;
    // the local + URL state already updated optimistically. The
    // server action validates against the operator's identity.
    const campaignKey = currentCampaignId ?? "_default";
    saveInboxAccountFilter({
      campaignKey,
      // Empty array = clear the entry (revert to "every account I
      // can see" for this campaign on the next page render).
      accountIds: next.size === accounts.length ? [] : Array.from(next),
    }).catch(() => {
      /* network blip — local state remains correct; next reload
         falls back to whatever the server has, which might be
         slightly stale */
    });
  }

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applySelection(next);
  }

  function selectAll() {
    applySelection(new Set(accounts.map((a) => a.id)));
  }
  function clearAll() {
    applySelection(new Set());
  }
  function myAccountsOnly() {
    applySelection(new Set(accounts.filter((a) => a.isMine).map((a) => a.id)));
  }
  function accountsWithIssues() {
    applySelection(new Set(accounts.filter((a) => a.health !== "healthy").map((a) => a.id)));
  }

  const totalUnread = accounts
    .filter((a) => selectedIds.has(a.id))
    .reduce((sum, a) => sum + a.unreadCount, 0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Account switcher"
        title="Switch which mailboxes are visible"
        className={cn(
          "relative inline-flex h-8 w-8 items-center justify-center rounded-full",
          "bg-gradient-to-br from-indigo-500 to-violet-600 font-semibold text-sm text-white",
          "shadow-sm transition-transform hover:scale-105",
          "ring-2 ring-transparent hover:ring-indigo-200 dark:hover:ring-indigo-900/40",
        )}
      >
        {currentUserInitial.toUpperCase()}
        {/* Tiny dot in the corner when any account has issues — Gmail
            does the same with a red dot on the avatar. */}
        {accounts.some((a) => a.health !== "healthy") && (
          <span className="-right-0.5 -top-0.5 absolute h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-zinc-950" />
        )}
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute top-full right-0 z-30 mt-2 w-96 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <header className="border-zinc-200 border-b bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              Visible accounts
            </p>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              {selectedIds.size} of {accounts.length} selected · {totalUnread} unread
            </p>
          </header>
          {/* Account list. */}
          <ul className="max-h-80 overflow-y-auto py-1">
            {accounts.length === 0 ? (
              <li className="px-4 py-6 text-center text-xs text-zinc-500">
                No connected accounts. Connect one from Settings → Inboxes.
              </li>
            ) : (
              accounts.map((a) => (
                <li key={a.id}>
                  <AccountRow
                    account={a}
                    selected={selectedIds.has(a.id)}
                    onToggle={() => toggle(a.id)}
                  />
                </li>
              ))
            )}
          </ul>
          {/* Quick actions. */}
          <div className="flex flex-wrap items-center gap-1 border-zinc-200 border-t bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
            <QuickAction onClick={selectAll}>Select all</QuickAction>
            <QuickAction onClick={clearAll}>Clear</QuickAction>
            <QuickAction onClick={myAccountsOnly}>My accounts</QuickAction>
            {accounts.some((a) => a.health !== "healthy") && (
              <QuickAction onClick={accountsWithIssues}>Issues</QuickAction>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountRow({
  account,
  selected,
  onToggle,
}: {
  account: VisibleAccount;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-2 text-left transition-colors",
        "hover:bg-zinc-50 dark:hover:bg-zinc-900/60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          selected
            ? "border-indigo-600 bg-indigo-600 dark:border-indigo-500 dark:bg-indigo-500"
            : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900",
        )}
      >
        {selected && <Check className="h-3 w-3 text-white" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-xs">
            {account.ownerName ?? "Unknown owner"}
            {account.isMine && (
              <span className="ml-1 rounded-full bg-indigo-100 px-1.5 py-0.5 font-mono text-[8px] text-indigo-700 uppercase tracking-widest dark:bg-indigo-950/40 dark:text-indigo-300">
                You
              </span>
            )}
          </span>
          <HealthBadge health={account.health} />
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-500">
          {account.emailAddress}
        </span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
          <span className={cn(account.coldSendsUsed >= account.coldSendCap && "text-rose-600")}>
            {account.coldSendsUsed}/{account.coldSendCap} sent
          </span>
          {account.unreadCount > 0 && (
            <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 font-mono text-[9px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {account.unreadCount} unread
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function HealthBadge({ health }: { health: AccountHealth }) {
  if (health === "healthy") {
    return null; // Healthy is the unmarked default — Gmail does the same.
  }
  if (health === "needs_reauth") {
    return (
      <span
        title="Token expired — needs reauth"
        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0 font-mono text-[8px] text-amber-700 uppercase tracking-widest dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
      >
        <RotateCw className="h-2 w-2" />
        Reauth
      </span>
    );
  }
  if (health === "disconnected") {
    return (
      <span
        title="Disconnected"
        className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-zinc-100 px-1.5 py-0 font-mono text-[8px] text-zinc-600 uppercase tracking-widest dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
      >
        <ShieldOff className="h-2 w-2" />
        Off
      </span>
    );
  }
  return (
    <span
      title="Error connecting"
      className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0 font-mono text-[8px] text-rose-700 uppercase tracking-widest dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
    >
      <AlertTriangle className="h-2 w-2" />
      Error
    </span>
  );
}

function QuickAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-widest hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
    >
      {children}
    </button>
  );
}
