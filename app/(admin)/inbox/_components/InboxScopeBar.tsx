"use client";

/**
 * InboxScopeBar -- Gmail-style horizontal strip of TRIAGE filters above
 * the thread list. Each is a quick-select pill mapping to URL params:
 *
 *   Unassigned    ?unassigned=1
 *   Unmatched     ?unmatched=1  (no venue linked yet)
 *   Needs Reply   ?folder=needs_reply (also a left-rail folder; the
 *                 most common triage scope, so surfaced here too)
 *   Stale         ?stale=1
 *   Mentioned     ?mentioned=1
 *
 * The earlier "Team Inbox / View All / Assigned to Me / My Inboxes"
 * pills were removed: they duplicated the top "Showing: All team / This
 * campaign / Mine" visibility toggle and caused confusion. Visibility
 * lives in that toggle; this bar is purely triage state.
 *
 * The active pill is computed from the current URL, so straying from a
 * named preset (search, chip drill-down) deselects every pill. That's
 * intentional: triage filters compose with search/chips.
 */

import { cn } from "@/lib/cn";
import { AlertTriangle, AtSign, HelpCircle, Mail, MailQuestion } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

interface Props {
  /** Unread @-mention count for the current user (Phase D). Drives
   *  the badge on the Mentioned scope pill. */
  mentionCount?: number;
}

type ScopeKey = "unassigned" | "unmatched" | "needs_reply" | "stale" | "mentioned";

export function InboxScopeBar({ mentionCount = 0 }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  // Resolve which triage preset is active. Order matters: more specific
  // predicates win.
  const active: ScopeKey | null = (() => {
    if (params.get("mentioned") === "1") return "mentioned";
    if (params.get("unmatched") === "1") return "unmatched";
    if (params.get("stale") === "1") return "stale";
    if (params.get("unassigned") === "1") return "unassigned";
    if (params.get("folder") === "needs_reply") return "needs_reply";
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
        "inbox-swipe-x flex shrink-0 items-center gap-1 border-zinc-200/80 border-b px-3 py-1.5",
        "dark:border-zinc-800/60",
      )}
    >
      <ScopePill
        active={active === "unassigned"}
        onClick={() =>
          go({
            unassigned: "1",
            staff: null,
            mine: null,
            unmatched: null,
            stale: null,
            mentioned: null,
          })
        }
        icon={<MailQuestion className="h-3 w-3" />}
        label="Unassigned"
      />
      <ScopePill
        active={active === "unmatched"}
        onClick={() =>
          go({
            unmatched: "1",
            staff: null,
            mine: null,
            unassigned: null,
            stale: null,
            mentioned: null,
          })
        }
        icon={<HelpCircle className="h-3 w-3" />}
        label="Unmatched"
      />
      <Divider />
      <ScopePill
        active={active === "needs_reply"}
        onClick={() =>
          go({
            folder: "needs_reply",
            staff: null,
            mine: null,
            unassigned: null,
            unmatched: null,
            stale: null,
            mentioned: null,
          })
        }
        icon={<Mail className="h-3 w-3" />}
        label="Needs Reply"
      />
      <ScopePill
        active={active === "stale"}
        onClick={() =>
          go({
            stale: "1",
            staff: null,
            mine: null,
            unassigned: null,
            unmatched: null,
            mentioned: null,
          })
        }
        icon={<AlertTriangle className="h-3 w-3" />}
        label="Stale"
      />
      <ScopePill
        active={active === "mentioned"}
        onClick={() =>
          go({
            mentioned: "1",
            staff: null,
            mine: null,
            unassigned: null,
            unmatched: null,
            stale: null,
            folder: null,
          })
        }
        icon={<AtSign className="h-3 w-3" />}
        label="Mentioned"
        badge={mentionCount > 0 ? mentionCount : undefined}
      />
    </div>
  );
}

function ScopePill({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** Optional unread badge — shown when > 0. Used by the
   *  Mentioned scope to surface pending @-tags (Phase D). */
  badge?: number;
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
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-mono text-[9px]",
            active ? "bg-indigo-600 text-white" : "bg-violet-600 text-white dark:bg-violet-500",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-3 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />;
}
