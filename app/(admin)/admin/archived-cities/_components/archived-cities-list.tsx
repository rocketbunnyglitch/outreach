"use client";

/**
 * Client-side list for /admin/archived-cities. Restore + Permanently
 * delete actions, mirroring /admin/archived-venues.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import { cn } from "@/lib/cn";
import { ArrowDownToLine, MapPin, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { hardDeleteCity, unarchiveCity } from "../../../cities/_actions";

interface Row {
  id: string;
  name: string;
  region: string | null;
  countryCode: string;
  countryName: string;
  timezone: string;
  archivedAt: string | null;
}

export function ArchivedCitiesList({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="card-surface px-6 py-10 text-center">
        <p className="font-medium text-sm text-zinc-600 dark:text-zinc-400">No archived cities.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Soft-deleted cities will show up here for restore.
        </p>
      </div>
    );
  }

  return (
    <ul className="card-surface divide-y divide-zinc-200/60 overflow-hidden dark:divide-zinc-800/40">
      {rows.map((row) => (
        <ArchivedCityRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

function ArchivedCityRow({ row }: { row: Row }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();

  function handleRestore() {
    startTx(async () => {
      try {
        const res = await unarchiveCity(row.id);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't restore city.",
            tag: "archived_cities.restore",
          });
          return;
        }
        toast.show({ kind: "success", message: `${row.name} restored.` });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "archived_cities.restore",
          fallback: "Couldn't restore city.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Permanently DELETE ${row.name}? Cascades through venues + campaigns + history. Cannot be undone.`,
      )
    ) {
      return;
    }
    if (!confirm("Are you absolutely sure?")) return;
    startTx(async () => {
      try {
        const res = await hardDeleteCity(row.id);
        if (!res.ok) {
          toast.show({
            kind: "error",
            message: res.error ?? "Couldn't permanently delete city.",
            tag: "archived_cities.hard_delete",
          });
          return;
        }
        toast.show({ kind: "success", message: `${row.name} deleted permanently.` });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "archived_cities.hard_delete",
          fallback: "Couldn't permanently delete city.",
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
          <Link href={`/cities/${row.id}`} className="truncate font-medium text-sm hover:underline">
            {row.name}
          </Link>
          {row.region && (
            <span className="font-mono text-[10px] text-zinc-500 tracking-wide">{row.region}</span>
          )}
          <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
            archived {archivedDate}
          </span>
        </div>
        <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          <MapPin className="mr-1 inline h-2.5 w-2.5" />
          {row.countryName} · {row.timezone}
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
