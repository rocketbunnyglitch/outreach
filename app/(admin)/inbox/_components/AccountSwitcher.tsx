"use client";

/**
 * AccountSwitcher -- inline multi-select dropdown that scopes the inbox
 * to a subset of connected mailboxes. Shown only on the "All team"
 * visibility scope (the operator's own inbox / a single campaign don't
 * need a cross-mailbox picker).
 *
 * Each row is a checkbox the operator can toggle to view one or more
 * specific mailboxes (e.g. a teammate's inbox). The applied filter
 * lives ONLY in the URL as ?accounts=<id>,<id> -- it is intentionally
 * session-scoped: it survives opening a thread + hitting back (the URL
 * is carried through navigation) but resets to "All inboxes" on a fresh
 * page load. No localStorage, no server persistence.
 *
 * Trigger: a labeled button ("All inboxes" / one mailbox name / "N
 * mailboxes") rather than the old top-right avatar, which read as a
 * second profile menu and duplicated the "Showing" scope toggle.
 */

import { cn } from "@/lib/cn";
import type { AccountHealth, VisibleAccount } from "@/lib/visible-accounts";
import { AlertTriangle, Check, ChevronDown, Mail, RotateCw, ShieldOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  /** All accounts the operator is allowed to see. Includes their
   *  own plus team accounts; see lib/visible-accounts.loadVisibleAccounts. */
  accounts: VisibleAccount[];
}

export function AccountSwitcher({ accounts }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Selection comes ONLY from the URL (?accounts=). No localStorage /
  // server seed -- the picker is session-scoped by design. Initializing
  // from the URL is hydration-safe: useSearchParams returns the same
  // value on the server render and the first client render.
  const urlSelected = useMemo(() => {
    const raw = params.get("accounts");
    if (!raw) return null;
    return new Set(raw.split(",").filter(Boolean));
  }, [params]);

  // Default (no ?accounts=) = every account selected.
  const selectedIds: Set<string> = urlSelected ?? new Set(accounts.map((a) => a.id));

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const target = e.target as Node;
      // Exclude the trigger so a pointerdown on it doesn't close-then-
      // reopen via the button's onClick (the "needs multiple clicks" race).
      if (
        popRef.current &&
        !popRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function applySelection(next: Set<string>) {
    // Write the URL param so the thread query re-runs with the new
    // scope. Skip the param entirely when every account is selected
    // (or none) -- keeps URLs short for the default case and means a
    // fresh /inbox load lands on "All inboxes".
    const url = new URL(window.location.href);
    if (next.size === 0 || next.size === accounts.length) {
      url.searchParams.delete("accounts");
    } else {
      url.searchParams.set("accounts", Array.from(next).join(","));
    }
    router.replace(`${url.pathname}${url.search}`);
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
  const anyIssues = accounts.some((a) => a.health !== "healthy");

  // Trigger label: "All inboxes" when everything (or nothing) is
  // explicitly selected, the single mailbox name when exactly one, else
  // a count.
  const triggerLabel = (() => {
    const n = selectedIds.size;
    if (n === 0 || n === accounts.length) return "All inboxes";
    if (n === 1) {
      const only = accounts.find((a) => selectedIds.has(a.id));
      return only?.emailAddress ?? "1 mailbox";
    }
    return `${n} mailboxes`;
  })();

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Choose which mailboxes to view"
        title="Choose which mailboxes to view"
        aria-expanded={open}
        className={cn(
          "inline-flex max-w-[220px] items-center gap-1.5 rounded-md border px-2 py-1.5 font-medium text-[11px] transition-colors sm:py-0.5",
          "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
        )}
      >
        <Mail className="h-3 w-3 shrink-0" />
        <span className="truncate font-mono">{triggerLabel}</span>
        {anyIssues && (
          <span
            title="One or more inboxes need reconnecting"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500"
          />
        )}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute top-full left-0 z-30 mt-2 w-96 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        >
          <header className="border-zinc-200 border-b bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              Visible mailboxes
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
            {anyIssues && <QuickAction onClick={accountsWithIssues}>Issues</QuickAction>}
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
