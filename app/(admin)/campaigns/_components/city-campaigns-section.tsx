"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CityProgressRow } from "@/lib/city-progress";
import { cn } from "@/lib/cn";
import { X } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { AddRemainingCitiesButton } from "./add-remaining-cities-button";
import { BulkAddCities } from "./bulk-add-cities";
import { BulkAddCrawls } from "./bulk-add-crawls";
import { CityProgressCard } from "./city-progress-card";

interface CityOption {
  id: string;
  name: string;
  region: string | null;
}

interface CityCampaignRow {
  id: string;
  cityName: string;
  cityRegion: string | null;
  priority: number;
  targetVenueCount: number;
  salesGoalCents: bigint | null;
  status: string;
  leadStaffName: string | null;
}

interface Props {
  campaignId: string;
  cityCampaigns: CityCampaignRow[];
  progressRows: CityProgressRow[];
  unassignedCities: CityOption[];
  addAction: (prev: unknown, fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Whether the signed-in operator is an admin. Used to gate the dollar
   * fields (sales goal cents) per session 11 decision #025 — outreach
   * staff should not see dollar amounts. Non-admins still see + edit
   * priority, target counts, lead staff, status — just not money.
   */
  isAdmin?: boolean;
}

/**
 * "Cities in this campaign" inline section on the campaign edit page.
 * Lets the operator pick a city + priority and add it, and shows existing
 * city-campaigns with a link to drill into each.
 *
 * Filtering / sorting (operator session 11)
 * -----------------------------------------
 * Once a campaign has 20-30 cities (now easy after the bulk-add CSV
 * ship in this same session), unfiltered scrolling is no longer
 * viable. Controls above the list:
 *
 *   - Status pills: All / Planning / Active / Confirmed / Cancelled
 *   - Sort dropdown: priority desc/asc, sales-goal desc, status,
 *     lead-staff name A-Z, city name A-Z
 *   - Unassigned-only toggle: filters to cities with no lead staffer
 *
 * State is local (no URL params yet). Future iteration could persist
 * the operator's last choices in a cookie or query string.
 */

type SortKey = "priority_high" | "priority_low" | "sales_goal" | "status" | "lead" | "name";

const STATUS_FILTERS = ["all", "planning", "active", "confirmed", "cancelled"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function CityCampaignsSection({
  campaignId,
  cityCampaigns,
  progressRows,
  unassignedCities,
  addAction,
  isAdmin = false,
}: Props) {
  const [sortBy, setSortBy] = useState<SortKey>("priority_high");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  // Bulk-select state: a Set of cityCampaign IDs. Empty = no selection
  // (bulk-action bar hidden). The checkboxes always render on each row;
  // the bar appears only when ≥1 is selected.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const displayRows = useMemo(() => {
    const filtered = progressRows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (unassignedOnly && r.leadStaffName) return false;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "priority_high":
          // 1 = highest, so ascending numeric = highest-priority first.
          // Tie-break by city name.
          return a.priority - b.priority || a.cityName.localeCompare(b.cityName);
        case "priority_low":
          return b.priority - a.priority || a.cityName.localeCompare(b.cityName);
        case "sales_goal": {
          // Highest goal first; nulls last.
          const av = a.salesGoalCents ?? 0n;
          const bv = b.salesGoalCents ?? 0n;
          if (av === bv) return a.cityName.localeCompare(b.cityName);
          return bv > av ? 1 : -1;
        }
        case "status":
          return a.status.localeCompare(b.status) || a.priority - b.priority;
        case "lead": {
          // Cities with a lead, alphabetized; unassigned at the bottom.
          const av = a.leadStaffName ?? "~~~"; // tilde sorts after letters
          const bv = b.leadStaffName ?? "~~~";
          return av.localeCompare(bv);
        }
        case "name":
          return a.cityName.localeCompare(b.cityName);
        default:
          return 0;
      }
    });
    return sorted;
  }, [progressRows, sortBy, statusFilter, unassignedOnly]);

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllVisible() {
    setSelectedIds(new Set(displayRows.map((r) => r.cityCampaignId)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  const selectedCount = selectedIds.size;
  const allVisibleSelected =
    displayRows.length > 0 && displayRows.every((r) => selectedIds.has(r.cityCampaignId));

  async function handleBulkDelete() {
    if (selectedCount === 0) return;
    const confirmed = window.confirm(
      `Permanently remove ${selectedCount} ${
        selectedCount === 1 ? "city" : "cities"
      } from this campaign? This deletes any crawls scheduled for them too. This cannot be undone.`,
    );
    if (!confirmed) return;
    setDeleteError(null);
    setDeletePending(true);
    try {
      const { removeCityCampaignsBulk } = await import("../_actions");
      const r = await removeCityCampaignsBulk({
        campaignId,
        cityCampaignIds: Array.from(selectedIds),
      });
      if (!r.ok) {
        setDeleteError(r.error ?? "Bulk delete failed.");
        return;
      }
      clearSelection();
    } finally {
      setDeletePending(false);
    }
  }

  async function handleSingleDelete(id: string, cityName: string) {
    const confirmed = window.confirm(
      `Permanently remove ${cityName} from this campaign? This deletes any crawls scheduled for it too. This cannot be undone.`,
    );
    if (!confirmed) return;
    setDeleteError(null);
    try {
      const { removeCityCampaign } = await import("@/app/(admin)/city-campaigns/_actions");
      await removeCityCampaign(id);
    } catch {
      setDeleteError("Couldn't delete. Try again.");
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-2xl tracking-tight ">Cities</h2>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
            {displayRows.length === cityCampaigns.length
              ? `${cityCampaigns.length} ${cityCampaigns.length === 1 ? "city" : "cities"}`
              : `${displayRows.length} of ${cityCampaigns.length}`}
          </span>
        </div>
      </header>

      <BulkAddCities
        campaignId={campaignId}
        unassignedCities={unassignedCities}
        renderManualForm={() => (
          <AddCityForm
            campaignId={campaignId}
            unassignedCities={unassignedCities}
            action={addAction}
            isAdmin={isAdmin}
            onCancel={() => {
              /* manual form has no cancel here — embedded in tab */
            }}
          />
        )}
      />

      {/* Bulk-add-crawls — sibling action that schedules a crawl
          (event) in every city in this campaign on the same date.
          Hidden when there are no cities yet (the button would just
          error). */}
      {cityCampaigns.length > 0 && (
        <BulkAddCrawls campaignId={campaignId} cityCount={cityCampaigns.length} />
      )}

      {/* Add-remaining-cities — admin sweep that dumps every
          un-assigned city into the campaign at MAX(priority) + 1.
          Mounted alongside BulkAddCrawls so admins see the two
          large-batch operations together. */}
      <div className="flex justify-end">
        <AddRemainingCitiesButton campaignId={campaignId} isAdmin={isAdmin} />
      </div>

      {cityCampaigns.length === 0 ? (
        <Card className="border-dashed bg-transparent p-6 text-center text-sm text-zinc-500">
          No cities in this campaign yet. Add one to start planning events.
        </Card>
      ) : (
        <>
          {/* Filter / sort bar — only shown when there are enough cities to
              make it useful (3+). For a 1-2 city campaign this is noise. */}
          {cityCampaigns.length >= 3 && (
            <div className="flex flex-wrap items-center gap-2 border-zinc-200 border-y py-2 dark:border-zinc-800">
              <StatusPillRow value={statusFilter} onChange={setStatusFilter} rows={progressRows} />
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUnassignedOnly((s) => !s)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 font-medium text-[11px] transition-colors",
                    unassignedOnly
                      ? "border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-100"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
                  )}
                  aria-pressed={unassignedOnly}
                  title="Show only cities with no lead staffer"
                >
                  Unassigned only
                </button>
                <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.12em]">
                  Sort
                </span>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                  <SelectTrigger className="h-7 w-[160px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priority_high">Priority (high → low)</SelectItem>
                    <SelectItem value="priority_low">Priority (low → high)</SelectItem>
                    <SelectItem value="sales_goal">Sales goal (high)</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                    <SelectItem value="lead">Lead staffer</SelectItem>
                    <SelectItem value="name">Name (A-Z)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Bulk-action bar — appears when ≥1 row is selected. Shows
              count, select-all, "add crawl to selected", and bulk delete
              (admin-only). Sits between the filter bar and the list so
              it's visible alongside its selection target. */}
          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50/60 p-2 text-xs dark:border-blue-900/40 dark:bg-blue-950/30">
              <span className="font-medium text-blue-900 dark:text-blue-100">
                {selectedCount} selected
              </span>
              <button
                type="button"
                onClick={selectAllVisible}
                disabled={allVisibleSelected}
                className="rounded-md border border-blue-200 px-2 py-1 text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-40 dark:border-blue-900/60 dark:text-blue-200 dark:hover:bg-blue-900/40"
              >
                Select all visible
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Clear
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={deletePending}
                  className="ml-auto rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950"
                >
                  {deletePending
                    ? "Deleting…"
                    : `Delete ${selectedCount} ${selectedCount === 1 ? "city" : "cities"}`}
                </button>
              )}
              {deleteError && (
                <span className="text-rose-600 dark:text-rose-300">{deleteError}</span>
              )}
            </div>
          )}

          {/* Add-crawl-to-selected — uses the existing BulkAddCrawls UI
              in scoped-selection mode. Hidden unless ≥1 row is selected. */}
          {selectedCount > 0 && (
            <BulkAddCrawls
              campaignId={campaignId}
              cityCount={cityCampaigns.length}
              selectedCityCampaignIds={Array.from(selectedIds)}
            />
          )}

          {displayRows.length === 0 ? (
            <Card className="border-dashed bg-transparent p-6 text-center text-sm text-zinc-500">
              No cities match the current filter. Try widening the filter or clearing it.
            </Card>
          ) : (
            <ol className="flex flex-col gap-2">
              {displayRows.map((row) => (
                <li key={row.cityCampaignId}>
                  <CityProgressCard
                    row={row}
                    selected={selectedIds.has(row.cityCampaignId)}
                    onToggleSelected={() => toggleOne(row.cityCampaignId)}
                    onDeleteRequest={
                      isAdmin
                        ? () => handleSingleDelete(row.cityCampaignId, row.cityName)
                        : undefined
                    }
                  />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Status filter pill row — counts each status so the operator can see
 * the distribution at a glance ("17 planning, 4 confirmed, 1 cancelled").
 * Empty buckets are hidden so the bar stays tight.
 */
function StatusPillRow({
  value,
  onChange,
  rows,
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
  rows: CityProgressRow[];
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [rows]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {STATUS_FILTERS.map((s) => {
        const count = s === "all" ? rows.length : (counts.get(s) ?? 0);
        if (s !== "all" && count === 0) return null; // hide empty buckets
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={cn(
              "rounded-md px-2 py-1 font-medium text-[11px] capitalize transition-colors",
              active
                ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
            aria-pressed={active}
          >
            {s}{" "}
            <span className={cn("ml-0.5 font-mono text-[10px]", active ? "" : "text-zinc-400")}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AddCityForm({
  campaignId,
  unassignedCities,
  action,
  onCancel,
  isAdmin = false,
}: {
  campaignId: string;
  unassignedCities: CityOption[];
  action: Props["addAction"];
  onCancel: () => void;
  isAdmin?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="font-medium text-xs text-zinc-500 uppercase tracking-widest">Add city</p>
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="campaignId" value={campaignId} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="cityId">City</Label>
            <Select name="cityId" required>
              <SelectTrigger id="cityId">
                <SelectValue placeholder="Pick a city" />
              </SelectTrigger>
              <SelectContent>
                {unassignedCities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.region ? ` (${c.region})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              name="priority"
              type="number"
              min="1"
              max="10"
              defaultValue="5"
              placeholder="5"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <NumField name="targetVenueCount" label="Target venues" defaultValue={4} />
          <NumField name="targetWristbandCount" label="Wristband (anchor)" defaultValue={1} />
          <NumField name="targetMiddleCount" label="Middle" defaultValue={2} />
          <NumField name="targetFinalCount" label="Final" defaultValue={1} />
        </div>
        {/* Sales goal — admin-only per decision #025. Outreach staff
            shouldn't see dollar fields; the value is set + tracked
            elsewhere by admin. Non-admins get nothing rendered here so
            the form stays compact for them. */}
        {isAdmin && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="salesGoalCents">Sales goal (cents)</Label>
            <Input
              id="salesGoalCents"
              name="salesGoalCents"
              type="number"
              min="0"
              placeholder="500000"
            />
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            <X className="h-3 w-3" /> Cancel
          </Button>
          <SubmitButton />
        </div>
      </form>
    </Card>
  );
}

function NumField({
  name,
  label,
  defaultValue,
}: { name: string; label: string; defaultValue: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min="0" defaultValue={defaultValue} />
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Adding…" : "Add"}
    </Button>
  );
}
