"use client";

/**
 * Cold-outreach contact-enrichment UI (PHASE E6).
 *
 * - BulkEnrichButton: top-of-table action. Previews eligible-vs-skipped,
 *   then runs the scrape in client-driven chunks so progress updates live
 *   (no SSE/Redis needed), then shows a completion summary.
 * - ContactDot: per-row status dot. Click enriches that one venue inline.
 *
 * Both talk to the server actions in app/(admin)/venues/_enrichment-actions.ts.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { EnrichVenueResult } from "@/lib/enrichment-orchestrator";
import { Loader2, MailSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  previewBulkEnrichment,
  triggerBulkEnrichment,
  triggerVenueEnrichment,
} from "../../venues/_enrichment-actions";

// =========================================================================
// Per-row status dot
// =========================================================================

type DotState = "has_email" | "no_website" | "attempted_failed" | "never";

export interface ContactDotProps {
  venueId: string;
  venueEmail: string | null;
  hasScrapedEmail: boolean;
  venueWebsite: string | null;
  enrichmentAttempted: boolean;
}

export function contactDotState(p: {
  venueEmail: string | null;
  hasScrapedEmail: boolean;
  venueWebsite: string | null;
  enrichmentAttempted: boolean;
}): DotState {
  if (p.venueEmail || p.hasScrapedEmail) return "has_email";
  if (!p.venueWebsite?.trim()) return "no_website";
  if (p.enrichmentAttempted) return "attempted_failed";
  return "never";
}

const DOT_META: Record<DotState, { cls: string; title: string; clickable: boolean }> = {
  has_email: {
    cls: "bg-emerald-500",
    title: "Has a contact email",
    clickable: false,
  },
  no_website: {
    cls: "bg-rose-400",
    title: "No website on file — nothing to scrape",
    clickable: false,
  },
  attempted_failed: {
    cls: "bg-amber-400",
    title: "Attempted, no email found — click to re-scrape (force)",
    clickable: true,
  },
  never: {
    cls: "bg-zinc-300 dark:bg-zinc-600",
    title: "Not attempted — click to pull contact info",
    clickable: true,
  },
};

export function ContactDot(props: ContactDotProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const state = contactDotState(props);
  const meta = DOT_META[state];

  function run() {
    if (!meta.clickable) {
      toast.show({ kind: "info", message: meta.title, tag: "enrichment.dot" });
      return;
    }
    startTransition(async () => {
      try {
        const r = await triggerVenueEnrichment(props.venueId, state === "attempted_failed");
        if (r.skipped) {
          toast.show({
            kind: "info",
            message: "Skipped (already has email or no website).",
            tag: "enrichment.dot",
          });
          return;
        }
        const found = r.emails_found ?? 0;
        toast.show({
          kind: found > 0 ? "success" : "info",
          message:
            found > 0 ? `Found ${found} email${found === 1 ? "" : "s"}.` : "No contacts found.",
          tag: "enrichment.dot",
        });
        router.refresh();
      } catch (err) {
        toast.show({ kind: "error", message: "Enrichment failed.", tag: "enrichment.dot" });
        console.error("[enrichment] dot enrich failed", err);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      title={meta.title}
      aria-label={meta.title}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
      ) : (
        <span className={`h-2.5 w-2.5 rounded-full ${meta.cls}`} />
      )}
    </button>
  );
}

// =========================================================================
// Bulk enrichment
// =========================================================================

interface PreviewCounts {
  eligible: number;
  skipped_has_email: number;
  skipped_no_website: number;
  skipped_already_attempted: number;
}

interface Progress {
  processed: number;
  total: number;
  found: number;
  tier1: number;
  tier2: number;
  none: number;
  skipped: number;
  cost: number;
}

const CHUNK = 5;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function tally(progress: Progress, results: EnrichVenueResult[]): Progress {
  const next = { ...progress };
  for (const r of results) {
    next.processed++;
    if (r.skipped) {
      next.skipped++;
      continue;
    }
    next.cost += r.cost_usd ?? 0;
    if ((r.emails_found ?? 0) > 0) {
      next.found++;
      if (r.tier_used === 2) next.tier2++;
      else next.tier1++;
    } else {
      next.none++;
    }
  }
  return next;
}

export function BulkEnrichButton({ venueIds }: { venueIds: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [previewing, startPreview] = useTransition();
  const [preview, setPreview] = useState<PreviewCounts | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  function openModal() {
    setOpen(true);
    setPreview(null);
    setProgress(null);
    setDone(false);
    startPreview(async () => {
      try {
        const counts = await previewBulkEnrichment(venueIds);
        setPreview(counts);
      } catch (err) {
        toast.show({ kind: "error", message: "Couldn't load preview.", tag: "enrichment.bulk" });
        console.error("[enrichment] preview failed", err);
        setOpen(false);
      }
    });
  }

  async function runBulk() {
    setRunning(true);
    let prog: Progress = {
      processed: 0,
      total: venueIds.length,
      found: 0,
      tier1: 0,
      tier2: 0,
      none: 0,
      skipped: 0,
      cost: 0,
    };
    setProgress(prog);
    try {
      for (const group of chunk(venueIds, CHUNK)) {
        const results = await triggerBulkEnrichment(group);
        prog = tally(prog, results);
        setProgress({ ...prog });
      }
      setDone(true);
      router.refresh();
    } catch (err) {
      toast.show({
        kind: "error",
        message: "Bulk enrichment failed partway.",
        tag: "enrichment.bulk",
      });
      console.error("[enrichment] bulk failed", err);
    } finally {
      setRunning(false);
    }
  }

  function close() {
    setOpen(false);
    setRunning(false);
  }

  const estMaxCost = preview ? (preview.eligible * 0.004).toFixed(2) : "0.00";

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={venueIds.length === 0}
        className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50/40 px-2.5 py-1 font-mono text-[10px] text-violet-700 uppercase tracking-[0.08em] transition-colors hover:bg-violet-100/60 disabled:opacity-50 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/50"
        title="Scrape websites of eligible venues for contact emails"
      >
        <MailSearch className="h-2.5 w-2.5" />
        Pull contacts
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={running ? undefined : close}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !running) close();
          }}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h4 className="font-semibold text-sm">Pull contacts for eligible venues</h4>

            {/* Preview */}
            {!progress && (
              <div className="mt-3 text-sm">
                {previewing || !preview ? (
                  <p className="flex items-center gap-2 text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking {venueIds.length} venues…
                  </p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-1 text-zinc-600 dark:text-zinc-300">
                      <li className="flex justify-between">
                        <span>Eligible to scrape</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {preview.eligible}
                        </span>
                      </li>
                      <li className="flex justify-between text-zinc-400">
                        <span>Skipped — already has email</span>
                        <span>{preview.skipped_has_email}</span>
                      </li>
                      <li className="flex justify-between text-zinc-400">
                        <span>Skipped — no website</span>
                        <span>{preview.skipped_no_website}</span>
                      </li>
                      <li className="flex justify-between text-zinc-400">
                        <span>Skipped — already attempted</span>
                        <span>{preview.skipped_already_attempted}</span>
                      </li>
                    </ul>
                    <p className="mt-3 text-xs text-zinc-500">
                      Est. cost $0.00 (Tier-1 only) up to ~${estMaxCost} if the AI fallback runs for
                      every eligible venue. Est. time ~
                      {Math.ceil((preview.eligible || 1) / CHUNK) * 15}s.
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={close}>
                        Cancel
                      </Button>
                      <Button type="button" onClick={runBulk} disabled={preview.eligible === 0}>
                        Scrape {preview.eligible} venue{preview.eligible === 1 ? "" : "s"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Progress + summary */}
            {progress && (
              <div className="mt-3 text-sm">
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all"
                    style={{
                      width: `${Math.round((progress.processed / Math.max(progress.total, 1)) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-2 flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                  {running && <Loader2 className="h-4 w-4 animate-spin" />}
                  {done ? "Done — " : "Scraping… "}
                  {progress.processed} of {progress.total}
                </p>
                <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500">
                  <li className="flex justify-between">
                    <span>Found contacts</span>
                    <span className="text-emerald-600 dark:text-emerald-400">{progress.found}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Skipped</span>
                    <span>{progress.skipped}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Tier 1 / Tier 2</span>
                    <span>
                      {progress.tier1}/{progress.tier2}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>No contacts</span>
                    <span>{progress.none}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Cost so far</span>
                    <span>${progress.cost.toFixed(4)}</span>
                  </li>
                </ul>
                {done && (
                  <div className="mt-4 flex justify-end">
                    <Button type="button" onClick={close}>
                      Close
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
