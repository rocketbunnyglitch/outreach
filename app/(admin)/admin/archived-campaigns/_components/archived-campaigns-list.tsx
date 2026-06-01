"use client";

/**
 * Client-side list for /admin/archived-campaigns. Mirrors the
 * archived-cities + archived-venues components.
 *
 * Hard delete uses the existing deleteCampaignWithConfirmation
 * action (typed confirm — operator must type the campaign name
 * exactly) since campaign cascade is the most destructive of the
 * three; the prompt is intentionally tedious.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import { cn } from "@/lib/cn";
import { ArrowDownToLine, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteCampaignWithConfirmation, unarchiveCampaign } from "../../../campaigns/_actions";

interface Row {
  id: string;
  name: string;
  slug: string;
  holidayType: string | null;
  startDate: string | null;
  endDate: string | null;
  archivedAt: string | null;
  outreachBrand: string;
  crawlBrand: string;
}

export function ArchivedCampaignsList({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="card-surface px-6 py-10 text-center">
        <p className="font-medium text-sm text-zinc-600 dark:text-zinc-400">
          No archived campaigns.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Archived campaigns will show up here for restore.
        </p>
      </div>
    );
  }

  return (
    <ul className="card-surface divide-y divide-zinc-200/60 overflow-hidden dark:divide-zinc-800/40">
      {rows.map((row) => (
        <ArchivedCampaignRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

function ArchivedCampaignRow({ row }: { row: Row }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();

  function handleRestore() {
    startTx(async () => {
      try {
        const res = await unarchiveCampaign(row.id);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't restore campaign.",
            tag: "archived_campaigns.restore",
          });
          return;
        }
        toast.show({
          kind: "success",
          message: `${row.name} restored (status: planning).`,
        });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "archived_campaigns.restore",
          fallback: "Couldn't restore campaign.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  function handleDelete() {
    // Campaign cascade is the most destructive of the three (cities,
    // venues, campaigns) — types every event + cold_outreach_entry +
    // city_campaign + campaign as archived in a single transaction.
    // Defense in depth: typed confirmation matching the campaign name.
    const typed = prompt(
      `Type the campaign name to permanently delete it.\n\nThis will cascade through every event, city_campaign, and cold outreach entry beneath it.\n\nName to type: ${row.name}`,
    );
    if (typed === null) return;
    if (typed !== row.name) {
      toast.show({
        kind: "error",
        message: "Name didn't match — campaign not deleted.",
      });
      return;
    }
    startTx(async () => {
      try {
        const res = await deleteCampaignWithConfirmation(row.id, typed);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't permanently delete campaign.",
            tag: "archived_campaigns.hard_delete",
          });
          return;
        }
        toast.show({
          kind: "success",
          message: `${row.name} fully archived (cascade complete).`,
        });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "archived_campaigns.hard_delete",
          fallback: "Couldn't permanently delete campaign.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  const archivedDate = row.archivedAt ? row.archivedAt.slice(0, 10) : "—";

  return (
    <li
      className={cn(
        "group flex flex-wrap items-start gap-3 px-5 py-3 transition-opacity",
        pending && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/campaigns/${row.id}`}
            className="truncate font-medium text-sm hover:underline"
          >
            {row.name}
          </Link>
          {row.holidayType && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[9px] text-zinc-700 uppercase tracking-[0.1em] dark:bg-zinc-800 dark:text-zinc-300">
              {row.holidayType}
            </span>
          )}
          <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
            archived {archivedDate}
          </span>
        </div>
        <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          {row.outreachBrand} → {row.crawlBrand}
          {row.startDate && (
            <>
              <span className="opacity-50"> · </span>
              {row.startDate}
              {row.endDate && row.endDate !== row.startDate && <> – {row.endDate}</>}
            </>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleRestore}
          disabled={pending}
        >
          <ArrowDownToLine className="h-3 w-3" />
          Restore
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={pending}
          className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
        >
          <Trash2 className="h-3 w-3" />
          Delete permanently
        </Button>
      </div>
    </li>
  );
}
