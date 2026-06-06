"use client";

/**
 * InboxVisibilityToggle — full-width scope bar pinned at the very top of
 * the inbox (above the three-pane shell). Lets the operator choose how
 * much email history they SEE:
 *
 *   All team       — every connected team account's threads (avoid
 *                    duplicate outreach across staff). allCampaigns=1.
 *   This campaign   — team threads scoped to the active campaign.
 *   Mine            — only the operator's own connected accounts. mine=1
 *                     (the server's `mine` filter restricts to
 *                     ownerUserId = me, so a teammate account can't be
 *                     surfaced via the ?accounts= URL param in this mode).
 *
 * Visibility is independent of SEND authority: staff can view team
 * history here but still only send from their own accounts (enforced
 * server-side in compose-send-impl + inbox/_actions). The account
 * switcher's visible set follows this scope (own-only in Mine mode).
 *
 * Maps onto existing URL params rather than a new one, so the data
 * loaders need no new plumbing: mine=1 / allCampaigns=1 / neither.
 */

import { cn } from "@/lib/cn";
import { Building2, User, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

export type VisibilityScope = "team" | "campaign" | "mine";

const OPTIONS: { value: VisibilityScope; label: string; icon: typeof Users }[] = [
  { value: "team", label: "All team", icon: Users },
  { value: "campaign", label: "This campaign", icon: Building2 },
  { value: "mine", label: "Mine", icon: User },
];

export function InboxVisibilityToggle({ scope }: { scope: VisibilityScope }) {
  const router = useRouter();
  const params = useSearchParams();

  function go(next: VisibilityScope) {
    if (next === scope) return;
    const p = new URLSearchParams(params?.toString() ?? "");
    p.delete("mine");
    p.delete("allCampaigns");
    p.delete("scope");
    if (next === "mine") p.set("mine", "1");
    else if (next === "campaign") p.set("scope", "campaign");
    // "team" = no scope params -> the DEFAULT (all team inboxes, all campaigns).
    // Scoping is opt-in: a user switches to Mine / This campaign to turn it on.
    const qs = p.toString();
    router.push(qs ? `/inbox?${qs}` : "/inbox");
  }

  return (
    <div className="flex items-center gap-2 border-zinc-200/70 border-b px-4 py-2 dark:border-zinc-800/60">
      <span className="hidden font-mono text-[10px] text-zinc-500 uppercase tracking-widest sm:inline">
        Showing
      </span>
      <div className="inline-flex items-center gap-0.5 rounded-full border border-zinc-200 bg-zinc-100/60 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60">
        {OPTIONS.map((o) => {
          const active = o.value === scope;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => go(o.value)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium text-xs transition-colors",
                active
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
              )}
            >
              <o.icon className="h-3.5 w-3.5" />
              {o.label}
            </button>
          );
        })}
      </div>
      <span className="ml-auto hidden text-[11px] text-zinc-400 md:inline">
        You can view team email here; sending stays limited to your own accounts.
      </span>
    </div>
  );
}
