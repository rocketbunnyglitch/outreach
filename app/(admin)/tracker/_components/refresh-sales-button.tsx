"use client";

/**
 * Tracker-level "Refresh sales" (operator request 2026-06-11): one
 * button that re-pulls ticket sales for EVERY Eventbrite-linked crawl
 * in the campaign, replacing per-card refresh buttons. Sales also
 * sync automatically — at link time and every 15 minutes via the
 * eventbrite-sync cron — so this is the impatience button for when
 * you want the tracker current RIGHT NOW.
 *
 * Reuses the all-crawls bulkSyncEventbriteSales action.
 */

import { bulkSyncEventbriteSales } from "@/app/(admin)/all-crawls/_actions";
import { useToast } from "@/components/ui/toast";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshSalesButton({ campaignId }: { campaignId: string }) {
  const [syncing, startSync] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function refresh() {
    const fd = new FormData();
    fd.set("campaignId", campaignId);
    startSync(async () => {
      const result = await bulkSyncEventbriteSales(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Sales refresh failed." });
        return;
      }
      const data = result.data;
      if (data && "notConfigured" in data) {
        toast.show({
          kind: "error",
          message: "Eventbrite isn't configured — set EVENTBRITE_PRIVATE_TOKEN on the server.",
        });
        return;
      }
      if (data && "synced" in data) {
        toast.show({
          kind: "success",
          message:
            data.totalLinked === 0
              ? "No crawls are linked to Eventbrite yet."
              : `Sales refreshed: ${data.synced} of ${data.totalLinked} linked crawls, ${data.ticketsTotal} tickets total.`,
        });
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={syncing}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      title="Re-pull ticket sales for every Eventbrite-linked crawl (also runs automatically every 15 minutes)"
    >
      {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {syncing ? "Refreshing…" : "Refresh sales"}
    </button>
  );
}
