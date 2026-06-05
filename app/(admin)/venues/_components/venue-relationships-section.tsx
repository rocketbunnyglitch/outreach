"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RelationshipSetBy, RelationshipStatus } from "@/db/schema";
import type { ActionResult } from "@/lib/form-utils";
import { Handshake, Loader2, Pencil, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

export interface VenueRelationshipRow {
  id: string;
  outreachBrandId: string;
  brandName: string;
  status: RelationshipStatus;
  setBy: RelationshipSetBy;
  notes: string | null;
  setByName: string | null;
  /** Preformatted server-side to avoid client date/locale work during render. */
  setAtLabel: string;
  autoClearAtLabel: string | null;
}

type SetAction = (
  prev: unknown,
  formData: FormData,
) => Promise<ActionResult<{ status: RelationshipStatus }>>;

type RemoveAction = (prev: unknown, formData: FormData) => Promise<ActionResult<{ id: string }>>;

interface Props {
  venueId: string;
  brands: { id: string; displayName: string }[];
  relationships: VenueRelationshipRow[];
  setAction: SetAction;
  removeAction: RemoveAction;
}

const STATUS_META: Record<RelationshipStatus, { label: string; badge: string; dot: string }> = {
  good: {
    label: "Good",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  neutral: {
    label: "Neutral",
    badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    dot: "bg-zinc-400",
  },
  bad: {
    label: "Bad",
    badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  no_history: {
    label: "No history",
    badge: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
    dot: "bg-zinc-300 dark:bg-zinc-600",
  },
};

const STATUS_ORDER: RelationshipStatus[] = ["good", "neutral", "bad", "no_history"];

const SET_BY_LABEL: Record<RelationshipSetBy, string> = {
  manual_operator: "set",
  auto_inbound: "auto-detected",
  post_event_flag: "post-event flag",
};

const SELECT_CLASS =
  "rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:focus:ring-zinc-600";

/**
 * Relationship status panel for the venue detail page (Phase 3.8). Lets
 * operators record, per outreach brand, whether this venue is a good / neutral
 * / bad relationship -- with a note. One row per brand; selecting a brand that
 * already has a flag updates it in place. Downstream the engine uses these
 * (3.9 auto-detect, 3.10 block bad pairs on send).
 */
export function VenueRelationshipsSection({
  venueId,
  brands,
  relationships,
  setAction,
  removeAction,
}: Props) {
  const [setState, doSet, saving] = useActionState(setAction, null);

  const [brandId, setBrandId] = useState<string>(brands[0]?.id ?? "");
  const [status, setStatus] = useState<RelationshipStatus>("neutral");
  const [notes, setNotes] = useState<string>("");

  function loadRowIntoForm(row: VenueRelationshipRow) {
    setBrandId(row.outreachBrandId);
    setStatus(row.status);
    setNotes(row.notes ?? "");
  }

  return (
    <section className="card-surface flex flex-col gap-4 p-5">
      <header className="flex items-baseline justify-between">
        <h2 className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight">
          <Handshake className="h-4 w-4 text-zinc-500" />
          Relationship status
          {relationships.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono font-normal text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {relationships.length}
            </span>
          )}
        </h2>
        <p className="hidden max-w-sm text-right text-[10px] text-zinc-400 sm:block">
          How this venue feels about each brand. A 'bad' flag warns (and later blocks) sends from
          that brand.
        </p>
      </header>

      <form
        action={(fd) => {
          // Form state is controlled; ensure the action sees the current values.
          fd.set("venueId", venueId);
          fd.set("outreachBrandId", brandId);
          fd.set("status", status);
          fd.set("notes", notes);
          doSet(fd);
        }}
        className="flex flex-col gap-2"
      >
        <select
          aria-label="Brand"
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
          className={`${SELECT_CLASS} w-full`}
        >
          {brands.length === 0 ? <option value="">No brands</option> : null}
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as RelationshipStatus)}
          className={`${SELECT_CLASS} w-full`}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <Input
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Note (optional) e.g. GM loves us, booked twice"
          autoComplete="off"
          maxLength={1000}
          className="w-full"
        />
        <Button type="submit" size="sm" disabled={saving || brandId === ""}>
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Save
        </Button>
      </form>
      {setState && !setState.ok && setState.error && <Alert tone="error">{setState.error}</Alert>}
      {setState?.ok && setState.data && (
        <Alert tone="success">
          Relationship saved as {STATUS_META[setState.data.status].label}.
        </Alert>
      )}

      {relationships.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 border-dashed bg-zinc-50/50 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <p className="text-sm text-zinc-500">No relationship flags yet.</p>
          <p className="mt-1 text-xs text-zinc-400">
            Record how this venue feels about a brand so the engine routes outreach accordingly.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {relationships.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-sm">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-[11px] ${meta.badge}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                    <span className="truncate">{r.brandName}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    {SET_BY_LABEL[r.setBy]} {r.setAtLabel}
                    {r.setByName ? ` by ${r.setByName}` : ""}
                    {r.autoClearAtLabel ? ` -- auto-clears ${r.autoClearAtLabel}` : ""}
                    {r.notes ? ` -- ${r.notes}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => loadRowIntoForm(r)}
                    aria-label={`Edit ${r.brandName} relationship`}
                    title="Load into the form to change"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <RemoveRelationshipButton
                    id={r.id}
                    venueId={venueId}
                    brandName={r.brandName}
                    removeAction={removeAction}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RemoveRelationshipButton({
  id,
  venueId,
  brandName,
  removeAction,
}: {
  id: string;
  venueId: string;
  brandName: string;
  removeAction: RemoveAction;
}) {
  const [state, doRemove, removing] = useActionState(removeAction, null);
  return (
    <form action={doRemove}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="venueId" value={venueId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={removing}
        aria-label={`Clear ${brandName} relationship`}
        title={state && !state.ok && state.error ? state.error : `Clear ${brandName} relationship`}
        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
      >
        {removing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </form>
  );
}
