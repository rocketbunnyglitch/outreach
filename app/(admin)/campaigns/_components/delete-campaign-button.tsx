"use client";

/**
 * DeleteCampaignButton — admin-gated, confirmation-required campaign
 * deletion. Sits at the bottom of /campaigns/[id] in a "danger zone"
 * card. Click → modal asking the operator to type the exact campaign
 * name → only then the delete fires.
 *
 * The server action soft-archives the campaign + every city_campaign,
 * event, and cold_outreach_entry underneath. Nothing is hard-deleted.
 *
 * UX: matches GitHub's repo-delete pattern. Friction is the point.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCampaignWithConfirmation } from "../_actions";

interface Props {
  campaignId: string;
  campaignName: string;
  /** Render nothing if the viewer isn't an admin. */
  isAdmin: boolean;
}

export function DeleteCampaignButton({ campaignId, campaignName, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const router = useRouter();
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  if (!isAdmin) return null;

  function submit() {
    setError(null);
    startTx(async () => {
      const result = await deleteCampaignWithConfirmation(campaignId, confirmText);
      if (!result.ok) {
        setError(result.error ?? "Couldn't delete.");
        return;
      }
      router.push("/campaigns");
      router.refresh();
    });
  }

  return (
    <>
      <div
        className={cn(
          "flex items-center justify-between rounded-2xl border border-rose-200/60 bg-rose-50/40 p-4",
          "dark:border-rose-900/40 dark:bg-rose-950/20",
        )}
      >
        <div>
          <p className="flex items-center gap-2 font-medium text-rose-900 text-sm dark:text-rose-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            Delete this campaign
          </p>
          <p className="mt-1 text-rose-800/80 text-xs dark:text-rose-300/70">
            Archives the campaign and all its city sheets, crawls, and cold-outreach entries.
            Soft-delete only — nothing is hard-removed from the DB. Admin only.
          </p>
        </div>
        <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete campaign…
        </Button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-6"
          onClick={() => !pending && setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pending) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div
            ref={trapRef}
            tabIndex={-1}
            className={cn(
              "card-surface w-full max-w-md p-6 outline-none",
              "animate-[fade-in_200ms_ease-out]",
            )}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-rose-100 p-2 dark:bg-rose-950">
                <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg tracking-tight">Delete campaign?</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  This archives <strong>{campaignName}</strong> and everything inside it — every
                  city sheet, every crawl, every cold-outreach entry. Reversible by an admin via a
                  DB update, but not from the UI.
                </p>
              </div>
            </div>
            <label className="mt-5 block">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
                Type the campaign name to confirm
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={campaignName}
                disabled={pending}
                className={cn(
                  "mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm",
                  "focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20",
                  "dark:border-zinc-700 dark:bg-zinc-900",
                )}
              />
            </label>
            {error && (
              <p
                className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                role="alert"
              >
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={submit}
                disabled={pending || confirmText !== campaignName}
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete forever
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
