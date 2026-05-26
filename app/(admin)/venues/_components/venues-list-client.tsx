"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { AlertTriangle, Archive, Shield, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { bulkUpdateVenues } from "../_actions";

interface VenueRow {
  id: string;
  name: string;
  address: string | null;
  capacity: number | null;
  doNotContact: boolean;
}

interface CityGroup {
  cityName: string;
  venues: VenueRow[];
}

interface Props {
  groups: CityGroup[];
  bulkAction: typeof bulkUpdateVenues;
}

/**
 * Venues list with multi-select + bulk action bar. Each city group has its
 * own "select all" checkbox; the bar appears at the top once anything is
 * selected and offers Mark DNC / Unmark DNC / Archive.
 */
export function VenuesListClient({ groups, bulkAction }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const total = groups.reduce((sum, g) => sum + g.venues.length, 0);
  const allIds = groups.flatMap((g) => g.venues.map((v) => v.id));
  const selectedCount = selected.size;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllInGroup(group: CityGroup) {
    const groupIds = group.venues.map((v) => v.id);
    const allInGroupSelected = groupIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allInGroupSelected) {
        for (const id of groupIds) next.delete(id);
      } else {
        for (const id of groupIds) next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(allIds));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  function runBulk(operation: "mark_dnc" | "unmark_dnc" | "archive") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    if (operation === "mark_dnc" && !reason && !reasonOpen) {
      setReasonOpen(true);
      return;
    }

    startTransition(async () => {
      const result = await bulkAction(
        ids,
        operation,
        operation === "mark_dnc" ? reason || undefined : undefined,
      );
      if (result.ok) {
        setFeedback(
          `Updated ${result.data.count} ${result.data.count === 1 ? "venue" : "venues"}.`,
        );
        setSelected(new Set());
        setReasonOpen(false);
        setReason("");
      } else {
        setFeedback(`Error: ${result.error}`);
      }
      // Clear feedback after a few seconds
      setTimeout(() => setFeedback(null), 4000);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {(selectedCount > 0 || feedback) && (
        <div className="-mx-2 sticky top-14 z-30 flex flex-col gap-3 border-zinc-200 border-b bg-[color:var(--color-canvas)]/95 px-2 py-3 backdrop-blur-md dark:border-zinc-800 dark:bg-[color:var(--color-canvas-dark)]/95">
          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium font-mono">{selectedCount} selected</span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  Clear
                </button>
                {selectedCount < total && (
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Select all {total}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => runBulk("mark_dnc")}
                >
                  <ShieldOff className="h-3 w-3" /> Mark DNC
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => runBulk("unmark_dnc")}
                >
                  <Shield className="h-3 w-3" /> Unmark DNC
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    if (
                      confirm(`Archive ${selectedCount} venues? They'll stop appearing in pickers.`)
                    ) {
                      runBulk("archive");
                    }
                  }}
                >
                  <Archive className="h-3 w-3" /> Archive
                </Button>
              </div>
            </div>
          )}
          {reasonOpen && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
              <span className="font-medium text-amber-900 text-xs dark:text-amber-200">
                DNC reason (optional, applied to all):
              </span>
              <Input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Owner asked to be removed"
                className="max-w-md flex-1"
              />
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={() => runBulk("mark_dnc")}
              >
                Confirm
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReasonOpen(false);
                  setReason("");
                }}
              >
                Cancel
              </Button>
            </div>
          )}
          {feedback && (
            <div
              className={cn(
                "text-xs",
                feedback.startsWith("Error")
                  ? "text-rose-700 dark:text-rose-400"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {feedback}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-8">
        {groups.map((group) => {
          const groupIds = group.venues.map((v) => v.id);
          const allInGroupSelected =
            groupIds.length > 0 && groupIds.every((id) => selected.has(id));
          const someInGroupSelected =
            !allInGroupSelected && groupIds.some((id) => selected.has(id));
          return (
            <section key={group.cityName} className="flex flex-col gap-2">
              <header className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={allInGroupSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someInGroupSelected;
                  }}
                  onChange={() => toggleAllInGroup(group)}
                  className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                  aria-label={`Select all venues in ${group.cityName}`}
                />
                <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                  {group.cityName} · {group.venues.length}
                </h2>
              </header>
              <div className="grid gap-2">
                {group.venues.map((venue) => (
                  <VenueListItem
                    key={venue.id}
                    venue={venue}
                    selected={selected.has(venue.id)}
                    onToggle={() => toggle(venue.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function VenueListItem({
  venue,
  selected,
  onToggle,
}: {
  venue: VenueRow;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Card
      className={cn(
        "flex items-center gap-4 p-4 transition-colors",
        selected ? "bg-zinc-50 dark:bg-zinc-900" : "hover:bg-zinc-50 dark:hover:bg-zinc-900",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
        aria-label={`Select ${venue.name}`}
      />
      <Link href={`/venues/${venue.id}`} className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">{venue.name}</h3>
          {venue.doNotContact && (
            <Badge tone="warning">
              <AlertTriangle className="h-3 w-3" />
              DNC
            </Badge>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          {venue.address ?? "No address"}
          {venue.capacity != null && ` · cap ${venue.capacity}`}
        </p>
      </Link>
    </Card>
  );
}
