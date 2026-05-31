"use client";

/**
 * InboxScopeBar — Gmail-style horizontal strip of named scope
 * presets above the thread list. Each preset is a quick-select
 * pill that maps to a combination of URL params on /inbox:
 *
 *   Team Inbox        clear everything (default for admins)
 *   View All          clear everything + clear ?accounts (the
 *                     "show me literally every team thread"
 *                     escape hatch)
 *   Assigned to Me    ?staff=<currentUserId>
 *   My Inboxes        ?mine=1
 *   Unassigned        ?unassigned=1
 *   Needs Reply       ?folder=needs_reply (also a real folder
 *                     in the left rail; we surface here too
 *                     because it's the most common triage scope)
 *   Stale             ?stale=1
 *
 * Default behavior per role:
 *   Staff   defaults to "Assigned to Me" or "My Inboxes" — the
 *           server-side handler enforces no actual data leakage,
 *           this is purely the initial pill on first visit
 *   Admin   defaults to "Team Inbox" — full team scope visible
 *           by default
 *
 * The "active" pill is computed from the current URL state, so
 * navigating through chip filters / search will deselect every
 * pill once the operator strays from a named preset. This is
 * intentional: chips + scopes compose, and we don't want a
 * stale "Team Inbox" highlight after the operator drilled
 * into a brand-specific view.
 */

import { cn } from "@/lib/cn";
import { AlertTriangle, Inbox, Mail, MailQuestion, User, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

interface Props {
  currentUserId: string;
  isAdmin: boolean;
}

type ScopeKey = "team" | "assigned" | "mine" | "unassigned" | "needs_reply" | "stale";

export function InboxScopeBar({ currentUserId, isAdmin }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  // Resolve which preset is currently active. Order matters: more
  // specific predicates win so e.g. "Unassigned" beats "Team Inbox"
  // even though both share the cleared assigned filter otherwise.
  const active: ScopeKey | null = (() => {
    if (params.get("stale") === "1") return "stale";
    if (params.get("unassigned") === "1") return "unassigned";
    if (params.get("folder") === "needs_reply") return "needs_reply";
    if (params.get("mine") === "1") return "mine";
    if (params.get("staff") === "mine" || params.get("staff") === currentUserId) return "assigned";
    // Distinguish "View All" (operator clicked it — ?accounts not set
    // either) from "Team Inbox" (operator just hasn't set anything).
    // Both have the same URL shape; for simplicity treat "team" as
    // the default highlight on /inbox without any preset signals.
    // "View All" is one explicit-click away to clear ?accounts too.
    if (!params.get("staff") && !params.get("mine") && !params.get("accounts")) {
      return isAdmin ? "team" : null;
    }
    return null;
  })();

  function go(overrides: Record<string, string | null>): void {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.push(qs ? `/inbox?${qs}` : "/inbox");
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 overflow-x-auto border-zinc-200/80 border-b px-3 py-1.5",
        "dark:border-zinc-800/60",
      )}
    >
      <ScopePill
        active={active === "team"}
        onClick={() =>
          go({
            staff: null,
            mine: null,
            unassigned: null,
            stale: null,
            folder: null,
          })
        }
        icon={<Users className="h-3 w-3" />}
        label="Team Inbox"
      />
      <ScopePill
        active={false}
        onClick={() =>
          go({
            staff: null,
            mine: null,
            unassigned: null,
            stale: null,
            folder: null,
            accounts: null, // explicit escape: clear visibility scope too
          })
        }
        icon={<Inbox className="h-3 w-3" />}
        label="View All"
      />
      <Divider />
      <ScopePill
        active={active === "assigned"}
        onClick={() => go({ staff: "mine", mine: null, unassigned: null, stale: null })}
        icon={<User className="h-3 w-3" />}
        label="Assigned to Me"
      />
      <ScopePill
        active={active === "mine"}
        onClick={() => go({ mine: "1", staff: null, unassigned: null, stale: null })}
        icon={<Mail className="h-3 w-3" />}
        label="My Inboxes"
      />
      <ScopePill
        active={active === "unassigned"}
        onClick={() => go({ unassigned: "1", staff: null, mine: null, stale: null })}
        icon={<MailQuestion className="h-3 w-3" />}
        label="Unassigned"
      />
      <Divider />
      <ScopePill
        active={active === "needs_reply"}
        onClick={() =>
          go({ folder: "needs_reply", staff: null, mine: null, unassigned: null, stale: null })
        }
        icon={<Mail className="h-3 w-3" />}
        label="Needs Reply"
      />
      <ScopePill
        active={active === "stale"}
        onClick={() => go({ stale: "1", staff: null, mine: null, unassigned: null })}
        icon={<AlertTriangle className="h-3 w-3" />}
        label="Stale"
      />
    </div>
  );
}

function ScopePill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-[11px] transition-colors",
        active
          ? "border-indigo-400 bg-indigo-100 text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-100"
          : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-3 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />;
}
