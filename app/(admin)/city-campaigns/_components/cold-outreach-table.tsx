"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Check, Loader2, Mail, PhoneCall, Plus, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  acceptLeadSuggestions,
  archiveColdOutreachEntry,
  generateVenueLeads,
  updateColdOutreachField,
  upsertColdOutreachEntry,
} from "../_cold-outreach-actions";
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
export function ColdOutreachTable({ cityCampaignId, cityId, entries, staff }: Props) {
  const [adding, setAdding] = useState(false);

  if (entries.length === 0 && !adding) {
    return (
      <EmptyState
        cityCampaignId={cityCampaignId}
        cityId={cityId}
        onManualAdd={() => setAdding(true)}
      />
    );
  }

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
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
          status + ZeroBounce auto-tracked
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-zinc-200/60 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] dark:border-zinc-800/40">
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
                zebra={i % 2 === 1}
              />
            ))}
          </tbody>
        </table>
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
    </section>
  );
}

function ColdRow({
  entry,
  staff,
  cityCampaignId,
  zebra,
}: {
  entry: ColdEntry;
  staff: Array<{ id: string; displayName: string }>;
  cityCampaignId: string;
  zebra: boolean;
}) {
  const [pending, startTx] = useTransition();
  const tone = zebra ? "bg-zinc-50/60 dark:bg-zinc-900/30" : "bg-white dark:bg-zinc-900/10";

  function commitField(field: "status" | "assignedStaffId" | "remarks", value: string) {
    const fd = new FormData();
    fd.set("entryId", entry.entryId);
    fd.set("field", field);
    fd.set("value", value);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      await updateColdOutreachField(null, fd);
    });
  }

  function archive() {
    if (!confirm(`Archive ${entry.venueName} from cold outreach?`)) return;
    const fd = new FormData();
    fd.set("entryId", entry.entryId);
    fd.set("cityCampaignId", cityCampaignId);
    startTx(async () => {
      await archiveColdOutreachEntry(null, fd);
    });
  }

  return (
    <tr
      className={cn(
        tone,
        "group border-zinc-200/40 border-b transition-colors duration-150 dark:border-zinc-800/30",
        pending && "opacity-60",
      )}
    >
      {/* Venue */}
      <td className="px-3 py-2 align-middle">
        <Link
          href={`/venues/${entry.venueId}`}
          className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
        >
          {entry.venueName}
        </Link>
      </td>

      {/* Email */}
      <td className="px-2 py-2 align-middle">
        {entry.venueEmail ? (
          <a
            href={`mailto:${entry.venueEmail}`}
            className="block max-w-[170px] truncate font-mono text-[11px] text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {entry.venueEmail}
          </a>
        ) : (
          <span className="font-mono text-[10px] text-zinc-400">—</span>
        )}
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

      {/* Phone */}
      <td className="px-2 py-2 align-middle">
        {entry.venuePhone ? (
          <a
            href={`tel:${entry.venuePhone}`}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <PhoneCall className="h-2.5 w-2.5" />
            {entry.venuePhone}
          </a>
        ) : (
          <span className="font-mono text-[10px] text-zinc-400">—</span>
        )}
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
        />
      </td>

      {/* Archive */}
      <td className="px-1 py-2 align-middle">
        <button
          type="button"
          onClick={archive}
          disabled={pending}
          className="rounded-md p-1 text-zinc-400 opacity-0 transition-all duration-150 hover:bg-rose-500/[0.08] hover:text-rose-600 group-hover:opacity-100"
          aria-label="Archive"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
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
}: {
  initial: string;
  pending: boolean;
  onCommit: (v: string) => void;
}) {
  const [committed, setCommitted] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCommitted(initial);
    setDraft(initial);
  }, [initial]);

  function commit() {
    if (draft === committed) return;
    onCommit(draft);
    setCommitted(draft);
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
            e.currentTarget.blur();
          }
        }}
        disabled={pending}
        placeholder="Add remarks…"
        className={cn(
          "h-7 border-transparent bg-transparent pr-6 text-xs transition-colors",
          "hover:border-zinc-300 hover:bg-white focus:border-zinc-400 focus:bg-white",
          "dark:focus:border-zinc-600 dark:focus:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-900",
          "placeholder:text-zinc-400/60",
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
