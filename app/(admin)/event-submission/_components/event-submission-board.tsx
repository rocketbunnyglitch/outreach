"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  Check,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Square,
  SquareCheck,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  type CitySubmissionGroup,
  type SubmissionSiteRow,
  archiveSubmissionSite,
  toggleSubmissionSite,
  upsertSubmissionSite,
} from "../_actions";

interface DraftState {
  id?: string;
  cityId: string;
  name: string;
  url: string;
  notes: string;
}

export function EventSubmissionBoard({
  groups,
  cityOptions,
}: {
  groups: CitySubmissionGroup[];
  cityOptions: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTx] = useTransition();
  const toast = useToast();

  function startAdd(cityId: string) {
    setError(null);
    setDraft({ cityId, name: "", url: "", notes: "" });
  }

  function startEdit(cityId: string, site: SubmissionSiteRow) {
    setError(null);
    setDraft({
      id: site.id,
      cityId,
      name: site.name,
      url: site.url ?? "",
      notes: site.notes ?? "",
    });
  }

  function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Site name is required.");
      return;
    }
    const wasEdit = !!draft.id;
    const siteName = draft.name.trim();
    startTx(async () => {
      try {
        const result = await upsertSubmissionSite({
          id: draft.id,
          cityId: draft.cityId,
          name: draft.name,
          url: draft.url,
          notes: draft.notes,
        });
        if (!result.ok) {
          setError(result.error ?? "Couldn't save.");
          toast.show({
            kind: "error",
            message: result.error ?? "Couldn't save site.",
            code: result.code,
          });
          return;
        }
        setDraft(null);
        toast.show({
          kind: "success",
          message: wasEdit ? `Updated "${siteName}".` : `Added "${siteName}".`,
        });
        router.refresh();
      } catch (err) {
        console.error("[event-submission] save failed", err);
        setError("Couldn't save — try again.");
        toast.show({ kind: "error", message: "Couldn't save — try again." });
      }
    });
  }

  function toggle(site: SubmissionSiteRow) {
    startTx(async () => {
      try {
        await toggleSubmissionSite({ id: site.id, submitted: !site.submitted });
        toast.show({
          kind: "success",
          message: !site.submitted
            ? `Marked "${site.name}" submitted.`
            : `Marked "${site.name}" not submitted.`,
        });
        router.refresh();
      } catch (err) {
        console.error("[event-submission] toggle failed", err);
        setError("Couldn't update — try again.");
        toast.show({ kind: "error", message: "Couldn't update site status." });
      }
    });
  }

  function remove(site: SubmissionSiteRow) {
    if (!confirm(`Remove "${site.name}"?`)) return;
    startTx(async () => {
      try {
        await archiveSubmissionSite({ id: site.id });
        toast.show({ kind: "success", message: `Removed "${site.name}".` });
        router.refresh();
      } catch (err) {
        console.error("[event-submission] remove failed", err);
        setError("Couldn't remove — try again.");
        toast.show({ kind: "error", message: "Couldn't remove site." });
      }
    });
  }

  const citiesWithSites = groups.filter((g) => g.sites.length > 0);
  const emptyCities = groups.filter((g) => g.sites.length === 0);

  return (
    <div className="flex flex-col gap-5">
      {error && <p className="text-rose-600 text-sm">{error}</p>}

      {draft && (
        <DraftForm
          draft={draft}
          setDraft={setDraft}
          cityOptions={cityOptions}
          pending={pending}
          onSave={save}
          onCancel={() => {
            setDraft(null);
            setError(null);
          }}
        />
      )}

      {!draft && (
        <div>
          <Button
            type="button"
            onClick={() => startAdd(cityOptions[0]?.id ?? "")}
            disabled={pending}
          >
            <Plus className="h-4 w-4" /> Add site
          </Button>
        </div>
      )}

      {citiesWithSites.length === 0 && !draft ? (
        <div className="card-surface-quiet p-10 text-center text-sm text-zinc-500">
          No submission sites yet. Add the first site to start tracking where crawls get posted.
        </div>
      ) : (
        citiesWithSites.map((g) => (
          <section key={g.cityId} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold text-base tracking-tight">
                {g.cityName}
                {g.region && (
                  <span className="ml-2 font-normal text-sm text-zinc-500">{g.region}</span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => startAdd(g.cityId)}
                disabled={pending}
                className="inline-flex items-center gap-0.5 font-mono text-[10px] text-zinc-500 uppercase tracking-widest hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                <Plus className="h-3 w-3" /> site
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800/60">
              <table className="w-full text-sm">
                <tbody>
                  {g.sites.map((s) => (
                    <tr
                      key={s.id}
                      className="group border-zinc-200/40 border-b last:border-0 dark:border-zinc-800/30"
                    >
                      <td className="w-10 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggle(s)}
                          disabled={pending}
                          className={cn(
                            "rounded p-0.5",
                            s.submitted ? "text-emerald-600" : "text-zinc-400 hover:text-zinc-700",
                          )}
                          aria-label={s.submitted ? "Mark not submitted" : "Mark submitted"}
                          title={s.submitted ? "Submitted" : "Not submitted"}
                        >
                          {s.submitted ? (
                            <SquareCheck className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div
                          className={cn("font-medium", s.submitted && "text-zinc-500 line-through")}
                        >
                          {s.name}
                        </div>
                        {s.notes && <div className="text-[11px] text-zinc-500">{s.notes}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {s.url && (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[12px] text-blue-600 hover:underline dark:text-blue-400"
                          >
                            <ExternalLink className="h-3 w-3" /> open
                          </a>
                        )}
                      </td>
                      <td className="w-20 px-3 py-2">
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => startEdit(g.cityId, s)}
                            disabled={pending}
                            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                            aria-label={`Edit ${s.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(s)}
                            disabled={pending}
                            className="rounded p-1 text-zinc-400 hover:bg-rose-500/[0.08] hover:text-rose-600"
                            aria-label={`Remove ${s.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {emptyCities.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-mono text-[10px] text-zinc-400 uppercase tracking-widest hover:text-zinc-600">
            {emptyCities.length} cities with no sites yet
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {emptyCities.map((g) => (
              <button
                key={g.cityId}
                type="button"
                onClick={() => startAdd(g.cityId)}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-300 border-dashed px-2.5 py-1 text-[12px] text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:hover:text-zinc-300"
              >
                <Plus className="h-3 w-3" /> {g.cityName}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function DraftForm({
  draft,
  setDraft,
  cityOptions,
  pending,
  onSave,
  onCancel,
}: {
  draft: DraftState;
  setDraft: (d: DraftState) => void;
  cityOptions: Array<{ id: string; name: string }>;
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="card-surface-quiet flex flex-col gap-3 p-4">
      <h3 className="font-semibold text-sm tracking-tight">
        {draft.id ? "Edit site" : "New submission site"}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="City">
          <select
            className={inputCls}
            value={draft.cityId}
            onChange={(e) => setDraft({ ...draft, cityId: e.target.value })}
            disabled={pending || !!draft.id}
          >
            {cityOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Site name">
          <input
            className={inputCls}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Eventbrite"
            disabled={pending}
          />
        </Field>
        <Field label="URL">
          <input
            className={inputCls}
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://…"
            disabled={pending}
          />
        </Field>
        <Field label="Notes">
          <input
            className={inputCls}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Login, cadence, gotchas"
            disabled={pending}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" onClick={onSave} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>
    </div>
  );
}

const inputCls = cn(
  "w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm",
  "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
  "dark:border-zinc-700 dark:bg-zinc-900",
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control is passed as children and nested inside the label
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">{label}</span>
      {children}
    </label>
  );
}
