"use client";

/**
 * Client-side list for /admin/archived-venues. Renders each row
 * with Restore + Permanently delete actions. Both wrapped in
 * toast feedback + a confirm prompt for delete.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import { cn } from "@/lib/cn";
import { ArrowDownToLine, Mail, Phone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { hardDeleteVenue, unarchiveVenue } from "../../../venues/_actions";

interface Row {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  phoneE164: string | null;
  archivedAt: string | null;
  cityName: string | null;
  cityRegion: string | null;
}

export function ArchivedVenuesList({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="card-surface px-6 py-10 text-center">
        <p className="font-medium text-sm text-zinc-600 dark:text-zinc-400">No archived venues.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Soft-deleted venues will show up here for restore.
        </p>
      </div>
    );
  }

  return (
    <ul className="card-surface divide-y divide-zinc-200/60 overflow-hidden dark:divide-zinc-800/40">
      {rows.map((row) => (
        <ArchivedVenueRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

function ArchivedVenueRow({ row }: { row: Row }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();

  function handleRestore() {
    startTx(async () => {
      try {
        const res = await unarchiveVenue(row.id);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't restore venue.",
            tag: "archived_venues.restore",
          });
          return;
        }
        toast.show({ kind: "success", message: `${row.name} restored.` });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "archived_venues.restore",
          fallback: "Couldn't restore venue.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Permanently DELETE ${row.name}? Cascades through outreach + events + history. Cannot be undone.`,
      )
    ) {
      return;
    }
    if (!confirm("Are you absolutely sure?")) return;
    startTx(async () => {
      try {
        const res = await hardDeleteVenue(row.id);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't permanently delete venue.",
            tag: "archived_venues.hard_delete",
          });
          return;
        }
        toast.show({ kind: "success", message: `${row.name} deleted permanently.` });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "archived_venues.hard_delete",
          fallback: "Couldn't permanently delete venue.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  const archivedDate = row.archivedAt ? row.archivedAt.slice(0, 10) : "—";
  const cityLabel = row.cityName
    ? row.cityRegion
      ? `${row.cityName}, ${row.cityRegion}`
      : row.cityName
    : "—";

  return (
    <li
      className={cn(
        "group flex flex-wrap items-start gap-3 px-5 py-3 transition-opacity",
        pending && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/venues/${row.id}`} className="truncate font-medium text-sm hover:underline">
            {row.name}
          </Link>
          <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
            archived {archivedDate}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {cityLabel}
          {row.address && (
            <>
              <span className="opacity-50"> · </span>
              {row.address}
            </>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-zinc-500">
        {row.email && <Mail className="h-3 w-3" aria-label={`Has email: ${row.email}`} />}
        {row.phoneE164 && <Phone className="h-3 w-3" aria-label={`Has phone: ${row.phoneE164}`} />}
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
