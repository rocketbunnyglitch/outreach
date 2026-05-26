"use client";

import { ActivityHistoryButton } from "@/components/ui/activity-history-button";
import { Button } from "@/components/ui/button";
import { InlineCell } from "@/components/ui/inline-cell";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useDraft } from "@/lib/use-draft";
import {
  Check,
  ExternalLink,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  acceptLeadSuggestions,
  archiveColdOutreachEntry,
  bulkArchiveColdOutreach,
  bulkAssignColdOutreach,
  bulkUnarchiveColdOutreach,
  bulkUpdateColdOutreachStatus,
  commitVenueField,
  generateVenueLeads,
  unarchiveColdOutreachEntry,
  updateColdOutreachField,
  upsertColdOutreachEntry,
} from "../_cold-outreach-actions";
import { AiDraftButton } from "./ai-draft-button";
import { AiSuggestVenuesModal } from "./ai-suggest-venues-modal";
import { BulkAiDraftModal } from "./bulk-ai-draft-modal";
import { QuoDialControls } from "./quo-dial-controls";
import { VenueAutocomplete } from "./venue-autocomplete";

interface ColdEntry {
  entryId: string;
  venueId: string;
  venueName: string;
  venueEmail: string | null;
  venuePhone: string | null;
  zeroBounceStatus: string | null;
  status: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  remarks: string | null;
  lastTouchAt: Date | null;
}

interface Props {
  cityCampaignId: string;
  cityId: string;
  /** Outreach brand id from the parent campaign — needed for Quo
   * calls + SMS to associate the activity with the right brand line. */
  outreachBrandId: string | null;
  entries: ColdEntry[];
  staff: Array<{ id: string; displayName: string }>;
}

const STATUS_OPTIONS: Array<{ value: string; label: string; tone: string }> = [
  { value: "not_contacted", label: "Not contacted", tone: "text-zinc-500" },
  { value: "email_sent", label: "Email sent", tone: "text-blue-600 dark:text-blue-400" },
  { value: "follow_up_due", label: "Follow-up due", tone: "text-amber-600 dark:text-amber-400" },
  { value: "called", label: "Called", tone: "text-blue-600 dark:text-blue-400" },
  { value: "voicemail", label: "Voicemail", tone: "text-amber-600 dark:text-amber-400" },
  { value: "no_answer", label: "No answer", tone: "text-amber-600 dark:text-amber-400" },
  { value: "interested", label: "Interested", tone: "text-emerald-600 dark:text-emerald-400" },
  { value: "declined", label: "Declined", tone: "text-rose-600 dark:text-rose-400" },
  { value: "bad_email", label: "Bad email", tone: "text-rose-600 dark:text-rose-400" },
  { value: "wrong_number", label: "Wrong number", tone: "text-rose-600 dark:text-rose-400" },
  { value: "do_not_contact", label: "Do not contact", tone: "text-zinc-500 line-through" },
];

const ZB_TONE: Record<string, string> = {
  valid: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  catch_all: "bg-amber-400/15 text-amber-700 ring-amber-400/25 dark:text-amber-300",
  unknown: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
  invalid: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  spamtrap: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  abuse: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  do_not_mail: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300",
};

/**
 * Cold outreach table for the city sheet.
 *
 * Each row: Venue · Email · ZeroBounce · Phone · Status · Assigned · Remarks
 *
 * Columns:
 *   • Venue       — name + link to /venues/[id]
 *   • Email       — mono, hover reveals copy/mailto, ZeroBounce pill
 *   • Phone       — mono, hover reveals tel: link
 *   • Status      — inline <select> from spec's status list (color-tinted)
 *   • Assigned    — inline staff <select>
 *   • Remarks     — inline <input>, blur/Enter to commit
 *   • Last touch  — auto-set when any field changes
 *   • Archive     — soft-delete button (row hover reveals)
 *
 * Empty state: prominent "Generate Venue Leads" CTA. When the Google
 * Maps API key isn't configured, the CTA shows a graceful explanation
 * + a "Add venue manually" affordance.
 *
 * Adding a venue: a quiet "+ Add venue" affordance at the table footer
 * triggers the venue autocomplete (re-used from slot picker) → adds an
 * entry with status='not_contacted'.
 */
export function ColdOutreachTable({
  cityCampaignId,
  cityId,
  outreachBrandId,
  entries,
  staff,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const router = useRouter();

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === entries.length ? new Set() : new Set(entries.map((e) => e.entryId)),
    );
  }

  function clearSelection() {
    setSelected(new Set());
  }

  if (entries.length === 0 && !adding) {
    return (
      <EmptyState
        cityCampaignId={cityCampaignId}
        cityId={cityId}
        onManualAdd={() => setAdding(true)}
      />
    );
  }

  const allSelected = selected.size > 0 && selected.size === entries.length;
  const someSelected = selected.size > 0 && selected.size < entries.length;

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <header className="flex items-baseline justify-between gap-3 border-zinc-200/60 border-b px-5 py-4 dark:border-zinc-800/40">
        <div className="flex items-baseline gap-2">
          <Mail className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-lg tracking-tight">
            Cold outreach
            <span className="ml-2 font-mono font-normal text-[11px] text-zinc-500">
              {entries.length} venue{entries.length === 1 ? "" : "s"}
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSuggestOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50/40 px-2.5 py-1 font-mono text-[10px] text-violet-700 uppercase tracking-[0.08em] transition-colors hover:bg-violet-100/60 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/50"
            title="Have Claude suggest new venues to add"
          >
            <Sparkles className="h-2.5 w-2.5" />
            Suggest venues
          </button>
          <p className="hidden font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em] sm:block">
            status + ZeroBounce auto-tracked
          </p>
        </div>
      </header>

      {selected.size > 0 && (
        <BulkActionBar
          selectedIds={Array.from(selected)}
          selectedEntries={entries.filter((e) => selected.has(e.entryId))}
          cityCampaignId={cityCampaignId}
          staff={staff}
          onComplete={clearSelection}
        />
      )}

      {/* Desktop table — hidden below md so the mobile card stack
          takes over. Cold outreach has 9 columns and that's never
          going to fit on a phone; the card layout below shows the
          same data + same actions vertically. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40">
              <th className="w-9 px-3 py-2.5">
                <SelectAllCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                />
              </th>
              <th className="w-48 px-3 py-2.5">Venue</th>
              <th className="w-44 px-2 py-2.5">Email</th>
              <th className="w-24 px-2 py-2.5">ZeroBounce</th>
              <th className="w-32 px-2 py-2.5">Phone</th>
              <th className="w-32 px-2 py-2.5">Status</th>
              <th className="w-28 px-2 py-2.5">Assigned</th>
              <th className="px-2 py-2.5">Remarks</th>
              <th className="w-8 px-1 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <ColdRow
                key={e.entryId}
                entry={e}
                staff={staff}
                cityCampaignId={cityCampaignId}
                outreachBrandId={outreachBrandId}
                selected={selected.has(e.entryId)}
                onToggleSelect={() => toggleOne(e.entryId)}
                zebra={i % 2 === 1}
                layout="table"
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card stack. Vertical layout, one card per venue,
          same actions + inline edits available. The sticky-ish
          select-all bar at top doubles as the bulk-target hint. */}
      <div className="md:hidden">
        {entries.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-zinc-200/60 border-b bg-zinc-50/40 px-4 py-2 dark:border-zinc-800/40 dark:bg-zinc-900/30">
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex cursor-pointer items-center gap-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]"
            >
              <SelectAllCheckbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={toggleAll}
              />
              {selected.size > 0 ? `${selected.size} selected` : "Select all"}
            </button>
            <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em]">
              {entries.length} venue{entries.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
        <ul className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
          {entries.map((e) => (
            <li key={e.entryId}>
              <ColdRow
                entry={e}
                staff={staff}
                cityCampaignId={cityCampaignId}
                outreachBrandId={outreachBrandId}
                selected={selected.has(e.entryId)}
                onToggleSelect={() => toggleOne(e.entryId)}
                zebra={false}
                layout="card"
              />
            </li>
          ))}
        </ul>
      </div>

      <footer className="flex items-center justify-between gap-3 border-zinc-200/60 border-t px-5 py-3 dark:border-zinc-800/40">
        {adding ? (
          <AddVenueRow
            cityId={cityId}
            cityCampaignId={cityCampaignId}
            onDone={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.1em] transition-colors hover:bg-blue-500/[0.08] hover:text-blue-700 dark:text-zinc-400 dark:hover:text-blue-300"
          >
            <Plus className="h-3 w-3" />
            Add venue
          </button>
        )}
        <GenerateLeadsButton cityCampaignId={cityCampaignId} cityId={cityId} compact />
      </footer>

      <AiSuggestVenuesModal
        cityCampaignId={cityCampaignId}
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        onAdded={() => router.refresh()}
      />
    </section>
  );
}

function ColdRow({
  entry,
  staff,
  cityCampaignId,
  outreachBrandId,
  selected,
  onToggleSelect,
  zebra,
  layout,
}: {
  entry: ColdEntry;
  staff: Array<{ id: string; displayName: string }>;
  cityCampaignId: string;
  outreachBrandId: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  zebra: boolean;
  layout: "table" | "card";
}) {
  const [pending, startTx] = useTransition();
  const toast = useToast();
  const tone = zebra ? "bg-zinc-50/60 dark:bg-zinc-900/30" : "bg-white dark:bg-zinc-900/10";

  function commitField(field: "status" | "assignedStaffId" | "remarks", value: string) {
    // Capture prior value so the undo handler can restore it
    const prior =
      field === "status"
        ? entry.status
        : field === "assignedStaffId"
          ? (entry.assignedStaffId ?? "")
          : (entry.remarks ?? "");

    const fd = new FormData();
    fd.set("entryId", entry.entryId);
    fd.set("field", field);
    fd.set("value", value);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await updateColdOutreachField(null, fd);
      if (!result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't save.",
        });
        return;
      }

      // Friendly message per field
      const verb =
        field === "status"
          ? `Status → ${STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value}`
          : field === "assignedStaffId"
            ? value
              ? `Assigned to ${staff.find((s) => s.id === value)?.displayName ?? "someone"}`
              : "Unassigned"
            : "Remarks updated";

      toast.show({
        kind: "success",
        message: `${entry.venueName} · ${verb}`,
        undo: async () => {
          const undoFd = new FormData();
          undoFd.set("entryId", entry.entryId);
          undoFd.set("field", field);
          undoFd.set("value", prior);
          undoFd.set("cityCampaignId", cityCampaignId);
          await updateColdOutreachField(null, undoFd);
        },
      });
    });
  }

  function archive() {
    const fd = new FormData();
    fd.set("entryId", entry.entryId);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await archiveColdOutreachEntry(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Couldn't archive." });
        return;
      }
      toast.show({
        kind: "success",
        message: `Archived ${entry.venueName}`,
        undo: async () => {
          const undoFd = new FormData();
          undoFd.set("entryId", entry.entryId);
          undoFd.set("cityCampaignId", cityCampaignId);
          await unarchiveColdOutreachEntry(null, undoFd);
        },
      });
    });
  }

  // ---------------------------------------------------------------
  // Card layout (mobile). Same fields, same handlers, vertical.
  // ---------------------------------------------------------------
  if (layout === "card") {
    return (
      <article
        className={cn(
          "flex flex-col gap-2.5 px-4 py-3 transition-colors",
          pending && "opacity-60",
          selected && "bg-blue-500/[0.06] dark:bg-blue-400/[0.06]",
        )}
      >
        {/* Header row: checkbox + name + status pill + open link */}
        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700"
            aria-label={`Select ${entry.venueName}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <InlineCell
                  label="Venue name"
                  value={entry.venueName}
                  onCommit={async (next) => {
                    const fd = new FormData();
                    fd.set("venueId", entry.venueId);
                    fd.set("field", "name");
                    fd.set("value", next);
                    fd.set("cityCampaignId", cityCampaignId);
                    const result = await commitVenueField(null, fd);
                    return { ok: result.ok, error: result.ok ? undefined : result.error };
                  }}
                />
              </div>
              <Link
                href={`/venues/${entry.venueId}`}
                className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                title="Open venue detail"
                aria-label="Open venue detail"
              >
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusSelect
                current={entry.status}
                pending={pending}
                onChange={(v) => commitField("status", v)}
              />
              <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-[0.08em]">
                ·
              </span>
              <AssignedSelect
                current={entry.assignedStaffId ?? ""}
                staff={staff}
                pending={pending}
                onChange={(v) => commitField("assignedStaffId", v)}
              />
              {entry.zeroBounceStatus && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ring-1 ring-inset",
                    ZB_TONE[entry.zeroBounceStatus] ??
                      "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
                  )}
                >
                  {entry.zeroBounceStatus.replace("_", " ")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Email + AI draft */}
        <div className="flex items-center gap-1.5 pl-6">
          <Mail className="h-3 w-3 shrink-0 text-zinc-400" />
          <div className="min-w-0 flex-1">
            <InlineCell
              label="Venue email"
              value={entry.venueEmail ?? ""}
              placeholder="add email"
              variant="mono"
              inputType="email"
              onCommit={async (next) => {
                const fd = new FormData();
                fd.set("venueId", entry.venueId);
                fd.set("field", "email");
                fd.set("value", next);
                fd.set("cityCampaignId", cityCampaignId);
                const result = await commitVenueField(null, fd);
                return { ok: result.ok, error: result.ok ? undefined : result.error };
              }}
            />
          </div>
          {entry.venueEmail && (
            <>
              <a
                href={`mailto:${entry.venueEmail}`}
                className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                aria-label="Open in email client"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
              <AiDraftButton
                venueId={entry.venueId}
                venueName={entry.venueName}
                cityCampaignId={cityCampaignId}
                onUseDraft={(draft) => {
                  const subject = encodeURIComponent(draft.subject);
                  const body = encodeURIComponent(draft.body);
                  window.open(
                    `mailto:${entry.venueEmail ?? ""}?subject=${subject}&body=${body}`,
                    "_self",
                  );
                }}
              />
            </>
          )}
        </div>

        {/* Phone with Quo controls */}
        <div className="pl-6">
          <PhoneCell
            entry={entry}
            cityCampaignId={cityCampaignId}
            outreachBrandId={outreachBrandId}
          />
        </div>

        {/* Remarks — full width inline edit */}
        <div className="rounded-md bg-zinc-50/60 px-2 py-1.5 dark:bg-zinc-900/40">
          <p className="mb-0.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.08em]">
            Remarks
          </p>
          <RemarksInput
            initial={entry.remarks ?? ""}
            pending={pending}
            onCommit={(v) => commitField("remarks", v)}
            draftKey={`remarks:${entry.entryId}`}
          />
        </div>

        {/* History + Archive */}
        <div className="flex items-center justify-between">
          <ActivityHistoryButton
            table="cold_outreach_entries"
            recordId={entry.entryId}
            alsoTable="venues"
            alsoRecordId={entry.venueId}
            compact
          />
          <button
            type="button"
            onClick={archive}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600"
            aria-label="Archive"
          >
            <Trash2 className="h-3 w-3" />
            Archive
          </button>
        </div>
      </article>
    );
  }

  // ---------------------------------------------------------------
  // Table layout (desktop) — original render below
  // ---------------------------------------------------------------
  return (
    <tr
      className={cn(
        tone,
        "group border-zinc-200/40 border-b transition-colors duration-150 dark:border-zinc-800/30",
        pending && "opacity-60",
        selected && "bg-blue-500/[0.05] dark:bg-blue-400/[0.06]",
      )}
    >
      {/* Selection checkbox */}
      <td className="px-3 py-2 align-middle">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700"
          aria-label={`Select ${entry.venueName}`}
        />
      </td>

      {/* Venue — inline-editable name. Operators can rename right from
          the table; the static link to /venues/[id] moves to a small
          arrow that appears on hover so quick edits don't require
          navigating away. */}
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-1">
          <InlineCell
            label="Venue name"
            value={entry.venueName}
            variant="default"
            maxWidth={220}
            onCommit={async (next) => {
              const fd = new FormData();
              fd.set("venueId", entry.venueId);
              fd.set("field", "name");
              fd.set("value", next);
              fd.set("cityCampaignId", cityCampaignId);
              const result = await commitVenueField(null, fd);
              return { ok: result.ok, error: result.ok ? undefined : result.error };
            }}
          />
          <Link
            href={`/venues/${entry.venueId}`}
            className="rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
            title="Open venue detail"
            aria-label="Open venue detail"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>
      </td>

      {/* Email — inline-editable address + AI draft button + mailto link.
          The mailto link only shows when there's a value to send to. */}
      <td className="relative px-2 py-2 align-middle">
        <div className="flex items-center gap-1">
          <InlineCell
            label="Venue email"
            value={entry.venueEmail ?? ""}
            placeholder="add email"
            variant="mono"
            inputType="email"
            maxWidth={150}
            onCommit={async (next) => {
              const fd = new FormData();
              fd.set("venueId", entry.venueId);
              fd.set("field", "email");
              fd.set("value", next);
              fd.set("cityCampaignId", cityCampaignId);
              const result = await commitVenueField(null, fd);
              return { ok: result.ok, error: result.ok ? undefined : result.error };
            }}
          />
          {entry.venueEmail && (
            <>
              <a
                href={`mailto:${entry.venueEmail}`}
                className="rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
                title="Open in email client"
                aria-label="Open in email client"
              >
                <Mail className="h-2.5 w-2.5" />
              </a>
              <AiDraftButton
                venueId={entry.venueId}
                venueName={entry.venueName}
                cityCampaignId={cityCampaignId}
                onUseDraft={(draft) => {
                  const subject = encodeURIComponent(draft.subject);
                  const body = encodeURIComponent(draft.body);
                  window.open(
                    `mailto:${entry.venueEmail ?? ""}?subject=${subject}&body=${body}`,
                    "_self",
                  );
                }}
              />
            </>
          )}
        </div>
      </td>

      {/* ZeroBounce */}
      <td className="px-2 py-2 align-middle">
        {entry.zeroBounceStatus ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset",
              ZB_TONE[entry.zeroBounceStatus] ?? "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
            )}
          >
            {entry.zeroBounceStatus.replace("_", " ")}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-zinc-400">unchecked</span>
        )}
      </td>

      {/* Phone — when present, QuoDialControls handles click-to-call /
          SMS / Viber. When absent or being edited, an inline cell lets
          the operator add or change the number. The pencil affordance
          on hover lets them switch from dial-mode to edit-mode anytime. */}
      <td className="relative px-2 py-2 align-middle">
        <PhoneCell
          entry={entry}
          cityCampaignId={cityCampaignId}
          outreachBrandId={outreachBrandId}
        />
      </td>

      {/* Status */}
      <td className="px-2 py-2 align-middle">
        <StatusSelect
          current={entry.status}
          pending={pending}
          onChange={(v) => commitField("status", v)}
        />
      </td>

      {/* Assigned */}
      <td className="px-2 py-2 align-middle">
        <AssignedSelect
          current={entry.assignedStaffId ?? ""}
          staff={staff}
          pending={pending}
          onChange={(v) => commitField("assignedStaffId", v)}
        />
      </td>

      {/* Remarks */}
      <td className="px-2 py-2 align-middle">
        <RemarksInput
          initial={entry.remarks ?? ""}
          pending={pending}
          onCommit={(v) => commitField("remarks", v)}
          draftKey={`remarks:${entry.entryId}`}
        />
      </td>

      {/* History + Archive — both row-hover affordances so the row
          itself reads calm when not interacting. */}
      <td className="px-1 py-2 align-middle">
        <div className="flex items-center gap-0.5">
          <div className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <ActivityHistoryButton
              table="cold_outreach_entries"
              recordId={entry.entryId}
              alsoTable="venues"
              alsoRecordId={entry.venueId}
              compact
            />
          </div>
          <button
            type="button"
            onClick={archive}
            disabled={pending}
            className="rounded-md p-1 text-zinc-400 opacity-0 transition-all duration-150 hover:bg-rose-500/[0.08] hover:text-rose-600 group-hover:opacity-100"
            aria-label="Archive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// =========================================================================
// PhoneCell — dial mode when number present, inline-edit when absent
// =========================================================================

function PhoneCell({
  entry,
  cityCampaignId,
  outreachBrandId,
}: {
  entry: ColdEntry;
  cityCampaignId: string;
  outreachBrandId: string | null;
}) {
  const [editing, setEditing] = useState(false);

  // No number yet → straight to inline-edit mode so adding a phone is
  // a single interaction
  if (!entry.venuePhone || editing) {
    return (
      <div className="flex items-center gap-1">
        <InlineCell
          label="Venue phone"
          value={entry.venuePhone ?? ""}
          placeholder="add phone"
          variant="mono"
          inputType="tel"
          maxWidth={140}
          onCommit={async (next) => {
            const fd = new FormData();
            fd.set("venueId", entry.venueId);
            fd.set("field", "phoneE164");
            fd.set("value", next);
            fd.set("cityCampaignId", cityCampaignId);
            const result = await commitVenueField(null, fd);
            if (result.ok) setEditing(false);
            return { ok: result.ok, error: result.ok ? undefined : result.error };
          }}
        />
        {entry.venuePhone && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded p-0.5 text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Cancel edit"
            title="Cancel"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    );
  }

  // Number present → show dial controls + a small pencil to switch
  // into edit mode
  return (
    <div className="flex items-center gap-1">
      <QuoDialControls
        venueId={entry.venueId}
        venueName={entry.venueName}
        venuePhone={entry.venuePhone}
        outreachBrandId={outreachBrandId}
        cityCampaignId={cityCampaignId}
        coldEntryId={entry.entryId}
      />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
        aria-label="Edit phone"
        title="Edit phone"
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function StatusSelect({
  current,
  pending,
  onChange,
}: {
  current: string;
  pending: boolean;
  onChange: (v: string) => void;
}) {
  const opt = STATUS_OPTIONS.find((o) => o.value === current);
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={pending}
      className={cn(
        "w-full appearance-none rounded-md border border-transparent bg-transparent px-2 py-1 font-medium font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
        "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none",
        "dark:focus:border-zinc-600 dark:hover:border-zinc-700",
        opt?.tone,
      )}
    >
      {STATUS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function AssignedSelect({
  current,
  staff,
  pending,
  onChange,
}: {
  current: string;
  staff: Array<{ id: string; displayName: string }>;
  pending: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      disabled={pending}
      className={cn(
        "w-full appearance-none rounded-md border border-transparent bg-transparent px-2 py-1 text-xs transition-colors",
        "hover:border-zinc-300 focus:border-zinc-400 focus:outline-none",
        "dark:focus:border-zinc-600 dark:hover:border-zinc-700",
      )}
    >
      <option value="">—</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.displayName.split(" ")[0]}
        </option>
      ))}
    </select>
  );
}

function RemarksInput({
  initial,
  pending,
  onCommit,
  draftKey,
}: {
  initial: string;
  pending: boolean;
  onCommit: (v: string) => void;
  /** Stable key for localStorage persistence. Pass to enable
      'never lose what I typed' behavior. */
  draftKey?: string;
}) {
  const [committed, setCommitted] = useState(initial);
  const [saved, setSaved] = useState(false);
  const {
    value: draft,
    setValue: setDraft,
    clearDraft,
    recovered,
  } = useDraft({
    key: draftKey ?? "",
    initial,
    enabled: !!draftKey,
  });

  useEffect(() => {
    setCommitted(initial);
  }, [initial]);

  function commit() {
    if (draft === committed) return;
    onCommit(draft);
    setCommitted(draft);
    clearDraft(); // Server now has it — drop the local copy
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  return (
    <div className="relative">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(committed);
            clearDraft();
            e.currentTarget.blur();
          }
        }}
        disabled={pending}
        placeholder={recovered ? "Restored draft — Enter to save" : "Add remarks…"}
        className={cn(
          "h-7 border-transparent bg-transparent pr-6 text-xs transition-colors",
          "hover:border-zinc-300 hover:bg-white focus:border-zinc-400 focus:bg-white",
          "dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
          "placeholder:text-zinc-400/60",
          recovered &&
            "border-amber-400/40 bg-amber-50/30 dark:border-amber-700/40 dark:bg-amber-950/20",
        )}
      />
      {(pending || saved) && (
        <div className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5">
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
          ) : (
            <Check className="h-3 w-3 text-emerald-500" />
          )}
        </div>
      )}
    </div>
  );
}

function AddVenueRow({
  cityId,
  cityCampaignId,
  onDone,
}: {
  cityId: string;
  cityCampaignId: string;
  onDone: () => void;
}) {
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSelect(v: { id: string; name: string }) {
    setError(null);
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("venueId", v.id);
    startTx(async () => {
      const result = await upsertColdOutreachEntry(null, fd);
      if (result.ok) onDone();
      else setError(result.error ?? "Add failed.");
    });
  }

  return (
    <div className="flex flex-1 items-center gap-2">
      <div className="w-64">
        <VenueAutocomplete
          cityId={cityId}
          selectedName={null}
          onSelect={handleSelect}
          placeholder="Search or create venue…"
          compact={false}
        />
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>
        <X className="h-3 w-3" />
      </Button>
      {error && <span className="text-rose-600 text-xs">{error}</span>}
    </div>
  );
}

function EmptyState({
  cityCampaignId,
  cityId,
  onManualAdd,
}: {
  cityCampaignId: string;
  cityId: string;
  onManualAdd: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-8 text-center shadow-sm shadow-zinc-200/40 dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
      <Mail className="mx-auto h-6 w-6 text-zinc-400" />
      <h2 className="mt-3 font-semibold text-lg tracking-tight">No cold outreach yet</h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-600 leading-relaxed dark:text-zinc-400">
        Generate a starting list of bars / clubs / restaurants in this city's nightlife cluster, or
        add venues one at a time.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <GenerateLeadsButton cityCampaignId={cityCampaignId} cityId={cityId} />
        <Button type="button" variant="outline" onClick={onManualAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add venue manually
        </Button>
      </div>
      <p className="mt-4 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
        cityId · {cityId.slice(0, 8)}…
      </p>
    </section>
  );
}

function GenerateLeadsButton({
  cityCampaignId,
  cityId,
  compact = false,
}: {
  cityCampaignId: string;
  cityId?: string;
  compact?: boolean;
}) {
  const [pending, startTx] = useTransition();
  const [importing, startImport] = useTransition();
  const [suggestions, setSuggestions] = useState<Array<{
    placeId: string;
    name: string;
    address: string | null;
    phone: string | null;
    website: string | null;
    rating: number | null;
    userRatingCount: number | null;
  }> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notConfigured, setNotConfigured] = useState(false);
  const [zeroSuggestions, setZeroSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function close() {
    setSuggestions(null);
    setSelected(new Set());
    setNotConfigured(false);
    setZeroSuggestions(false);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: close is stable
  useEffect(() => {
    const hasPopover = !!suggestions || notConfigured || zeroSuggestions;
    if (!hasPopover) return;
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [suggestions, notConfigured, zeroSuggestions]);

  function run() {
    close();
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      const result = await generateVenueLeads(null, fd);
      if (!result.ok || !result.data) return;
      if (result.data.notConfigured) {
        setNotConfigured(true);
        return;
      }
      if (result.data.suggestions.length === 0) {
        setZeroSuggestions(true);
        return;
      }
      setSuggestions(result.data.suggestions);
      // Pre-select all by default — operator unchecks any rejects
      setSelected(new Set(result.data.suggestions.map((s) => s.placeId)));
    });
  }

  async function importSelected() {
    if (!suggestions || !cityId || selected.size === 0) return;
    const chosen = suggestions.filter((s) => selected.has(s.placeId));
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("cityId", cityId);
    fd.set("suggestionsJson", JSON.stringify(chosen));
    startImport(async () => {
      const result = await acceptLeadSuggestions(null, fd);
      if (result.ok) {
        close();
      }
    });
  }

  function toggle(placeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }

  const Trigger = compact ? (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.1em] transition-colors hover:bg-emerald-500/[0.08] hover:text-emerald-700 dark:text-zinc-400 dark:hover:text-emerald-300"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      Generate leads
    </button>
  ) : (
    <Button type="button" onClick={run} disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
        </>
      ) : (
        <>
          <Sparkles className="h-3.5 w-3.5" /> Generate venue leads
        </>
      )}
    </Button>
  );

  return (
    <div ref={containerRef} className="relative inline-block">
      {Trigger}

      {notConfigured && (
        <div className="absolute top-full right-0 z-50 mt-1 w-72 rounded-lg border border-amber-200/80 bg-amber-50/95 p-3 text-xs shadow-lg dark:border-amber-900/40 dark:bg-amber-950/80">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Lead generation isn't configured yet
          </p>
          <p className="mt-1 text-amber-800/80 dark:text-amber-300/80">
            Add{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px] dark:bg-amber-900/40">
              GOOGLE_MAPS_API_KEY
            </code>{" "}
            to the server env and Places nearby-search will populate suggestions automatically.
          </p>
        </div>
      )}

      {zeroSuggestions && (
        <div className="absolute top-full right-0 z-50 mt-1 w-64 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-zinc-700 dark:text-zinc-300">
            No new suggestions — likely all nearby venues are already in your directory.
          </p>
        </div>
      )}

      {suggestions && (
        <div className="absolute top-full right-0 z-50 mt-1 w-[28rem] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <header className="flex items-baseline justify-between border-zinc-200/60 border-b px-4 py-2.5 dark:border-zinc-800/40">
            <h3 className="font-semibold text-sm tracking-tight">
              {suggestions.length} candidate{suggestions.length === 1 ? "" : "s"}
            </h3>
            <button
              type="button"
              onClick={() => {
                if (selected.size === suggestions.length) setSelected(new Set());
                else setSelected(new Set(suggestions.map((s) => s.placeId)));
              }}
              className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
            >
              {selected.size === suggestions.length ? "Deselect all" : "Select all"}
            </button>
          </header>
          <ul className="max-h-80 divide-y divide-zinc-200/40 overflow-auto dark:divide-zinc-800/30">
            {suggestions.map((s) => (
              <li key={s.placeId}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
                  <input
                    type="checkbox"
                    checked={selected.has(s.placeId)}
                    onChange={() => toggle(s.placeId)}
                    className="mt-1 h-3.5 w-3.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
                      {s.name}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {s.address ?? "no address"}
                    </p>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                      {s.rating != null && (
                        <span className="text-amber-600 dark:text-amber-400">
                          ★ {s.rating.toFixed(1)}
                          {s.userRatingCount != null && ` · ${s.userRatingCount}`}
                        </span>
                      )}
                      {s.phone && <span>{s.phone}</span>}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <footer className="flex items-center justify-between border-zinc-200/60 border-t px-4 py-2.5 dark:border-zinc-800/40">
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
              {selected.size} of {suggestions.length} selected
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={importSelected}
                disabled={selected.size === 0 || importing || !cityId}
              >
                {importing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" /> Importing…
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3" /> Import {selected.size}
                  </>
                )}
              </Button>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Bulk action bar — appears as a sticky strip below the table header when
// at least one row is selected. Three actions: change status, assign, archive.
// =========================================================================

function BulkActionBar({
  selectedIds,
  selectedEntries,
  cityCampaignId,
  staff,
  onComplete,
}: {
  selectedIds: string[];
  selectedEntries: Array<{
    entryId: string;
    venueId: string;
    venueName: string;
    venueEmail: string | null;
  }>;
  cityCampaignId: string;
  staff: Array<{ id: string; displayName: string }>;
  onComplete: () => void;
}) {
  const [pendingStatus, startStatus] = useTransition();
  const [pendingAssign, startAssign] = useTransition();
  const [pendingArchive, startArchive] = useTransition();
  const [bulkAiOpen, setBulkAiOpen] = useState(false);
  const toast = useToast();

  // How many of the selection actually have an email — drives the
  // Draft button label and enabled state.
  const eligibleForAi = selectedEntries.filter((e) => !!e.venueEmail).length;

  function setStatus(status: string) {
    const fd = new FormData();
    fd.set("entryIds", selectedIds.join(","));
    fd.set("status", status);
    fd.set("cityCampaignId", cityCampaignId);
    startStatus(async () => {
      const result = await bulkUpdateColdOutreachStatus(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Status update failed." });
        return;
      }
      const label = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
      toast.show({
        kind: "success",
        message: `${result.data?.updated ?? 0} venue${result.data?.updated === 1 ? "" : "s"} → ${label}`,
        // Bulk status undo is best-effort — we don't preserve per-row
        // prior statuses (cheap to add later if there's demand). For
        // now the undo button isn't offered on bulk status changes.
      });
      onComplete();
    });
  }

  function assign(staffMemberId: string) {
    const fd = new FormData();
    fd.set("entryIds", selectedIds.join(","));
    fd.set("staffMemberId", staffMemberId);
    fd.set("cityCampaignId", cityCampaignId);
    startAssign(async () => {
      const result = await bulkAssignColdOutreach(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Assignment failed." });
        return;
      }
      const assignee = staff.find((s) => s.id === staffMemberId)?.displayName ?? "unassigned";
      toast.show({
        kind: "success",
        message: `Assigned ${result.data?.updated ?? 0} venue${result.data?.updated === 1 ? "" : "s"} to ${assignee}`,
      });
      onComplete();
    });
  }

  function archive() {
    // No confirm() — the toast's Undo button is the safety net,
    // matching how Sheets handles delete (you can always Cmd+Z).
    const entryIds = [...selectedIds];
    const fd = new FormData();
    fd.set("entryIds", entryIds.join(","));
    fd.set("cityCampaignId", cityCampaignId);
    startArchive(async () => {
      const result = await bulkArchiveColdOutreach(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Archive failed." });
        return;
      }
      const count = result.data?.archived ?? 0;
      toast.show({
        kind: "success",
        message: `Archived ${count} venue${count === 1 ? "" : "s"}`,
        undo: async () => {
          const undoFd = new FormData();
          undoFd.set("entryIds", entryIds.join(","));
          undoFd.set("cityCampaignId", cityCampaignId);
          await bulkUnarchiveColdOutreach(null, undoFd);
        },
      });
      onComplete();
    });
  }

  const busy = pendingStatus || pendingAssign || pendingArchive;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-blue-200/60 border-b bg-blue-50/60 px-5 py-2.5 dark:border-blue-900/40 dark:bg-blue-950/30">
      <div className="flex items-center gap-2">
        <span className="font-medium font-mono text-[11px] text-blue-700 uppercase tracking-[0.08em] dark:text-blue-300">
          {selectedIds.length} selected
        </span>
        <button
          type="button"
          onClick={onComplete}
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          clear
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Bulk status */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            Status →
          </span>
          <select
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              if (v) setStatus(v);
              e.target.value = "";
            }}
            className="h-7 cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white px-2 pr-6 font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value="">change…</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {pendingStatus && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
        </div>

        {/* Bulk assign */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            Assign →
          </span>
          <select
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              if (v !== "_skip") assign(v);
              e.target.value = "_skip";
            }}
            className="h-7 cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white px-2 pr-6 font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] transition-colors hover:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
            defaultValue="_skip"
          >
            <option value="_skip">pick…</option>
            <option value="">— Unassign</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
          {pendingAssign && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
        </div>

        {/* Bulk AI drafts — only meaningful when at least one selected
            row has an email address; we still render the button even
            when 0 are eligible so the operator gets the modal's
            'no emails' explainer instead of a silent disabled state. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setBulkAiOpen(true)}
          disabled={busy}
          className="text-violet-600 hover:bg-violet-500/10 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
        >
          <Sparkles className="h-3 w-3" />
          Draft emails
          {eligibleForAi !== selectedIds.length && (
            <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.08em] opacity-70">
              ({eligibleForAi}/{selectedIds.length})
            </span>
          )}
        </Button>

        {/* Bulk archive */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={archive}
          disabled={busy}
          className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
        >
          {pendingArchive ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Archiving…
            </>
          ) : (
            <>
              <Trash2 className="h-3 w-3" /> Archive
            </>
          )}
        </Button>
      </div>

      <BulkAiDraftModal
        open={bulkAiOpen}
        entries={selectedEntries}
        cityCampaignId={cityCampaignId}
        onClose={() => setBulkAiOpen(false)}
      />
    </div>
  );
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  // React doesn't expose "indeterminate" as a prop — set it via ref
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 text-blue-600 transition-colors focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700"
      aria-label="Select all venues"
    />
  );
}
