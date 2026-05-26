"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Loader2, Plus, Share2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  assignMiddleGroup,
  createMiddleGroup,
  listMiddleGroupsForCityCampaign,
} from "../_middle-group-actions";

interface ExistingGroup {
  id: string;
  name: string;
  dayPart: string | null;
  memberCount: number;
}

interface Props {
  eventId: string;
  cityCampaignId: string;
  dayPart: "thursday_night" | "friday_night" | "saturday_night";
  currentGroupId: string | null;
  currentGroupName: string | null;
}

/**
 * Middle-venue-group picker for a single crawl.
 *
 * When closed:
 *   - If no group: shows a quiet "+ Use shared middle group" pill
 *   - If group attached: shows "Sharing with {group name} · unshare"
 *
 * When open:
 *   - Dropdown of existing groups for this city_campaign, filtered to
 *     the same day_part (so Friday crawls see Friday groups)
 *   - "Create new group" affordance below the list
 *   - Outside-click + Escape close it
 *
 * Server-action driven — no optimistic updates. Save is fast enough
 * (single update on events.middle_venue_group_id) that the page-level
 * revalidatePath in the action lands smoothly.
 */
export function MiddleGroupPicker({
  eventId,
  cityCampaignId,
  dayPart,
  currentGroupId,
  currentGroupName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ExistingGroup[]>([]);
  const [loading, startLoad] = useTransition();
  const [pending, startTx] = useTransition();
  const [newName, setNewName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy-load groups when the picker opens
  useEffect(() => {
    if (!open) return;
    startLoad(async () => {
      const result = await listMiddleGroupsForCityCampaign({
        cityCampaignId,
        dayPart,
      });
      setGroups(result);
    });
  }, [open, cityCampaignId, dayPart]);

  // Outside click + Escape
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleAssign(groupId: string | null) {
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("middleVenueGroupId", groupId ?? "_clear");
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      await assignMiddleGroup(null, fd);
      setOpen(false);
    });
  }

  function handleCreate() {
    if (!newName.trim()) return;
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("name", newName.trim());
    fd.set("dayPart", dayPart);
    fd.set("attachEventId", eventId);
    startTx(async () => {
      const result = await createMiddleGroup(null, fd);
      if (result.ok) {
        setNewName("");
        setOpen(false);
      }
    });
  }

  // Closed state — current attachment summary
  if (!open && currentGroupId) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href={`/middle-groups/${currentGroupId}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-orange-500/[0.08] px-2 py-1 font-mono text-[10px] text-orange-700 uppercase tracking-[0.08em] transition-colors hover:bg-orange-500/[0.15] dark:text-orange-300"
        >
          <Share2 className="h-3 w-3" />
          {currentGroupName ?? "shared middles"}
        </Link>
        <button
          type="button"
          onClick={() => handleAssign(null)}
          disabled={pending}
          className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600 disabled:opacity-50"
          aria-label="Unshare middle group"
          title="Unshare — revert to per-crawl middle slots"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      </div>
    );
  }

  // Closed state — no group, show CTA
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] transition-colors hover:bg-orange-500/[0.08] hover:text-orange-700 dark:text-zinc-400 dark:hover:text-orange-300"
      >
        <Share2 className="h-3 w-3" />
        Use shared middle group
      </button>
    );
  }

  // Open state — picker
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="inline-flex items-center gap-1.5 rounded-md bg-orange-500/[0.08] px-2 py-1 font-mono text-[10px] text-orange-700 uppercase tracking-[0.1em] dark:text-orange-300"
      >
        <Share2 className="h-3 w-3" />
        Pick a group…
      </button>
      <div className="absolute top-full right-0 z-50 mt-1 w-80 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        {loading && (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading groups…
          </div>
        )}
        {!loading && groups.length === 0 && (
          <p className="px-2 py-3 text-xs text-zinc-500 italic">
            No middle groups yet for this {dayLabel(dayPart)}. Create the first below.
          </p>
        )}
        {!loading && groups.length > 0 && (
          <ul className="space-y-0.5">
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => handleAssign(g.id)}
                  disabled={pending}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors",
                    "hover:bg-orange-500/[0.08] dark:hover:bg-orange-500/[0.12]",
                    pending && "opacity-50",
                  )}
                >
                  <span className="flex-1 truncate font-medium">{g.name}</span>
                  <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                    {g.memberCount} {g.memberCount === 1 ? "venue" : "venues"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Divider + create */}
        <div className="mt-2 border-zinc-200 border-t pt-2 dark:border-zinc-800">
          <p className="px-1 pb-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
            Or create new
          </p>
          <div className="flex items-center gap-1.5">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              placeholder={`${dayLabel(dayPart)} middles`}
              className="h-7 text-xs"
            />
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              disabled={!newName.trim() || pending}
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function dayLabel(dp: string): string {
  const day = dp.split("_")[0] ?? dp;
  return day.charAt(0).toUpperCase() + day.slice(1);
}
