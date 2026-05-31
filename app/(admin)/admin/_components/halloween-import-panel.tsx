"use client";

/**
 * Admin → Halloween 2025 import panel.
 *
 * Two-stage UI:
 *   1. "Dry run" button → renders a summary card: cities matched,
 *      counts by decision (exact/trgm/stub/skipped), per-origin
 *      tallies (confirmed/warm/cold). Operator reviews numbers
 *      + scans the first few decision rows for sanity.
 *   2. "Apply" button (revealed only after a successful dry-run)
 *      → runs the same code with dryRun=false. Same summary
 *      with REAL ids.
 *   3. "Download review queue" → emits the markdown the operator
 *      pastes into Claude Code so Claude in Chrome can verify
 *      stub + low-confidence venues against Google Maps.
 *
 * No charts, no fancy filters — this is a one-shot operator
 * tool. The dry-run report is the primary truth.
 */

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { ClipboardCopy, Download, Loader2, Play, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import {
  generateReviewQueueMarkdown,
  runHalloween2025Apply,
  runHalloween2025DryRun,
} from "../_actions-halloween-import";

// Local mirror of ImportReport — typing kept loose because we just
// display the numbers.
interface Report {
  dryRun: boolean;
  citiesAttempted: number;
  citiesMatched: number;
  citiesSkipped: number;
  campaignId: string | null;
  campaignSlug: string;
  countsByDecision: Record<string, number>;
  countsByOrigin: { confirmed: number; warm: number; cold: number };
  decisions: Array<{
    sourceCity: string;
    sourceVenueName: string;
    origin: string;
    venueDecision?: string;
    venueSimilarity?: number | null;
    cityMatch: { ok: boolean };
    wouldAddToColdOutreach: boolean;
    wouldAddVenueEvent: boolean;
  }>;
  warnings: string[];
}

export function HalloweenImportPanel() {
  const toast = useToast();
  const [running, startRun] = useTransition();
  const [report, setReport] = useState<Report | null>(null);
  const [stage, setStage] = useState<"idle" | "dry" | "applied">("idle");
  const [markdown, setMarkdown] = useState<string | null>(null);

  function runDry() {
    setMarkdown(null);
    startRun(async () => {
      const res = await runHalloween2025DryRun({ cityLimit: null });
      if (!res.ok) {
        toast.show({
          kind: "error",
          message: res.error,
          code: (res as { code?: string }).code,
          tag: "halloween.dry_run",
        });
        return;
      }
      setReport(res.data as Report);
      setStage("dry");
      toast.show({ kind: "success", message: `Dry-run done — ${res.data.decisions.length} rows.` });
    });
  }

  function runApply() {
    if (
      !confirm("Apply Halloween 2025 import? This writes the campaign + venues + events to the DB.")
    )
      return;
    startRun(async () => {
      const res = await runHalloween2025Apply({ cityLimit: null });
      if (!res.ok) {
        toast.show({
          kind: "error",
          message: res.error,
          code: (res as { code?: string }).code,
          tag: "halloween.apply",
        });
        return;
      }
      setReport(res.data as Report);
      setStage("applied");
      toast.show({
        kind: "success",
        message: "Import applied. Generate the review queue to verify stubs.",
      });
    });
  }

  function downloadReviewQueue() {
    if (!report) return;
    startRun(async () => {
      const res = await generateReviewQueueMarkdown(
        report as unknown as Parameters<typeof generateReviewQueueMarkdown>[0],
      );
      if (!res.ok) {
        toast.show({
          kind: "error",
          message: res.error,
          code: (res as { code?: string }).code,
          tag: "halloween.review_queue",
        });
        return;
      }
      setMarkdown(res.data.markdown);
      // Trigger a download
      const blob = new Blob([res.data.markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "halloween_2025_review_queue.md";
      a.click();
      URL.revokeObjectURL(url);
      toast.show({
        kind: "success",
        message: `Review queue downloaded — ${res.data.queue.items.length} venues to verify.`,
      });
    });
  }

  async function copyMarkdown() {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      toast.show({ kind: "success", message: "Review queue copied to clipboard." });
    } catch {
      toast.show({ kind: "error", message: "Couldn't copy. Use the download button instead." });
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      {/* Stage buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={runDry} disabled={running}>
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          Run dry-run
        </Button>

        {stage === "dry" && (
          <Button type="button" size="sm" variant="default" onClick={runApply} disabled={running}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Apply for real
          </Button>
        )}

        {stage === "applied" && (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50/60 px-2 py-1 font-mono text-[10px] text-emerald-800 uppercase tracking-[0.08em] dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
            applied
          </span>
        )}

        {report && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={downloadReviewQueue}
            disabled={running}
          >
            <Download className="h-3 w-3" />
            Download review queue
          </Button>
        )}

        {markdown && (
          <Button type="button" size="sm" variant="outline" onClick={copyMarkdown}>
            <ClipboardCopy className="h-3 w-3" />
            Copy markdown
          </Button>
        )}
      </div>

      {/* Report summary */}
      {report && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Cities attempted" value={report.citiesAttempted} />
          <Stat label="Cities matched" value={report.citiesMatched} tone="emerald" />
          <Stat label="Cities skipped" value={report.citiesSkipped} tone="amber" />
          <Stat label="Total decisions" value={report.decisions.length} />
          <Stat label="Exact matches" value={report.countsByDecision.exact ?? 0} tone="emerald" />
          <Stat label="Trgm matches" value={report.countsByDecision.trgm ?? 0} tone="blue" />
          <Stat label="Stub creates" value={report.countsByDecision.stub_new ?? 0} tone="amber" />
          <Stat label="Skipped" value={report.countsByDecision.skipped ?? 0} tone="zinc" />
        </div>
      )}

      {/* Per-origin breakdown */}
      {report && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Confirmed slots" value={report.countsByOrigin.confirmed} />
          <Stat label="Warm leads" value={report.countsByOrigin.warm} />
          <Stat label="Cold outreach" value={report.countsByOrigin.cold} />
        </div>
      )}

      {/* City skip reasons — pulls every decision with cityMatch.ok=false
          out as its own "X cities not matched" group so the operator
          sees which sheets failed city resolution. The fix is usually
          adding the missing city row to the cities table. */}
      {report &&
        (() => {
          const skippedCities = Array.from(
            new Set(report.decisions.filter((d) => !d.cityMatch.ok).map((d) => d.sourceCity)),
          );
          if (skippedCities.length === 0) return null;
          return (
            <div className="rounded-md border border-rose-200 bg-rose-50/40 px-3 py-2 text-xs dark:border-rose-900/40 dark:bg-rose-950/30">
              <p className="font-mono text-[10px] text-rose-700 uppercase tracking-[0.08em] dark:text-rose-300">
                Cities skipped (no DB match) — {skippedCities.length}
              </p>
              <p className="mt-1 text-rose-900 dark:text-rose-100">
                These sheets had no matching row in the `cities` table. Add them there first (city
                name + region + timezone), then re-run.
              </p>
              <ul className="mt-1 list-disc pl-4">
                {skippedCities.map((name) => (
                  <li key={name} className="text-rose-900 dark:text-rose-100">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

      {/* Warnings — per-row failures that didn't kill the import. The
          per-city + per-venue try/catch wrappers turn every failure
          into a warning here instead of a fatal 500. Show ALL of them
          (capped at 200 for sanity), with a click-to-expand for the
          full list when very long. */}
      {report && report.warnings.length > 0 && (
        <details className="rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs dark:border-amber-900/40 dark:bg-amber-950/30">
          <summary className="cursor-pointer font-mono text-[10px] text-amber-700 uppercase tracking-[0.08em] dark:text-amber-300">
            Per-row warnings ({report.warnings.length}) — click to expand
          </summary>
          <ul className="mt-2 list-disc pl-4">
            {report.warnings.slice(0, 200).map((w, i) => (
              <li
                key={`${i}-${w.slice(0, 30)}`}
                className="text-amber-900 leading-relaxed dark:text-amber-100"
              >
                <code className="font-mono text-[10px]">{w}</code>
              </li>
            ))}
            {report.warnings.length > 200 && (
              <li className="text-amber-700 dark:text-amber-300">
                …+{report.warnings.length - 200} more (truncated; check server logs)
              </li>
            )}
          </ul>
        </details>
      )}

      <p className="text-[11px] text-zinc-500 leading-relaxed dark:text-zinc-400">
        Reads <code>data/halloween_2025.json</code> (parsed from your xlsx). No external API calls.
        Matches each venue by exact-name → trigram-similar → stub-create. Backfills email/phone onto
        matched venues only when those fields are currently NULL — operator data is never
        overwritten. After applying, download the review queue and hand it to Claude Code (with
        Claude in Chrome) to verify stubs + low-confidence matches against Google Maps.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "blue" | "zinc";
}) {
  const valueClass = {
    emerald: "text-emerald-700 dark:text-emerald-300",
    amber: "text-amber-700 dark:text-amber-300",
    blue: "text-blue-700 dark:text-blue-300",
    zinc: "text-zinc-900 dark:text-zinc-100",
  }[tone];
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">{label}</div>
      <div className={cn("mt-1 font-mono font-semibold text-lg tabular-nums", valueClass)}>
        {value}
      </div>
    </div>
  );
}
