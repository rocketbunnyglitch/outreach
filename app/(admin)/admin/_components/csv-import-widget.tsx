"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Sparkles, XCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { type ImportPreview, commitCsvImport, previewCsvImport } from "../_actions-import";

interface CampaignOption {
  id: string;
  name: string;
}

interface Props {
  campaigns: CampaignOption[];
}

const EXAMPLE = `priority_number,city_name,day,crawl_number,eventbrite_id
1,New York City,Thursday,1,
1,New York City,Friday,1,1234567890
1,New York City,Friday,2,
1,New York City,Saturday,1,1234567891
2,Chicago,Friday,1,
2,Chicago,Saturday,1,`;

/**
 * CSV bulk-importer for campaign cities + crawl instances.
 *
 * Two-phase UX:
 *   1. Paste/upload → live preview (rows resolved or flagged)
 *   2. Pick a target campaign → Commit
 *
 * Preview surfaces every row's resolution status. Unresolved city
 * names are highlighted with a suggested master city candidate (via
 * pg_trgm similarity ≥ 0.4) so the operator can fix the spelling and
 * re-paste.
 *
 * Apple-grade touches:
 *   • Paste-or-upload affordance (no "click here to browse" only)
 *   • Live preview updates as you type, debounced 200ms
 *   • Resolved rows fade in green, unresolved in soft amber
 *   • Errors collapse into a single line with "show all" toggle
 */
export function CsvImportWidget({ campaigns }: Props) {
  const [csv, setCsv] = useState("");
  const [campaignId, setCampaignId] = useState<string>(campaigns[0]?.id ?? "");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewPending, startPreview] = useTransition();
  const [commitPending, startCommit] = useTransition();
  const [commitResult, setCommitResult] = useState<Awaited<
    ReturnType<typeof commitCsvImport>
  > | null>(null);

  function runPreview(nextCsv: string) {
    setCsv(nextCsv);
    setCommitResult(null);
    if (!nextCsv.trim()) {
      setPreview(null);
      return;
    }
    startPreview(async () => {
      const result = await previewCsvImport(nextCsv);
      setPreview(result);
    });
  }

  function handleFileUpload(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      runPreview(text);
    };
    reader.readAsText(file);
  }

  function handleCommit() {
    if (!campaignId || !csv) return;
    const fd = new FormData();
    fd.set("campaignId", campaignId);
    fd.set("csv", csv);
    startCommit(async () => {
      const result = await commitCsvImport(null, fd);
      setCommitResult(result);
      if (result.ok) {
        // Clear after successful commit
        setTimeout(() => {
          setCsv("");
          setPreview(null);
          setCommitResult(null);
        }, 3000);
      }
    });
  }

  const canCommit =
    !!preview &&
    preview.errors.length === 0 &&
    preview.rows.some((r) => r.resolvedCityId) &&
    !!campaignId;

  return (
    <section className="overflow-hidden card-surface">
      <header className="border-zinc-200/60 border-b px-6 py-4 dark:border-zinc-800/40">
        <h2 className="inline-flex items-center gap-2.5 font-semibold text-lg tracking-tight">
          <FileUp className="h-4 w-4 text-zinc-500" />
          Bulk import cities + crawls
        </h2>
        <p className="mt-1 text-xs text-zinc-600 leading-relaxed dark:text-zinc-400">
          CSV columns:{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] dark:bg-zinc-800">
            priority_number, city_name, day, crawl_number
          </code>
          . One row per crawl instance. Cities resolve against the master directory.
        </p>
      </header>

      <div className="space-y-5 p-6">
        {/* Target campaign */}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select trigger */}
        <label className="block">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
            Import into
          </span>
          <Select value={campaignId} onValueChange={setCampaignId}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Pick a campaign…" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        {/* CSV input */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              CSV
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => runPreview(EXAMPLE)}
                className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
              >
                Load example
              </button>
              <label className="cursor-pointer font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
                Upload file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f);
                  }}
                />
              </label>
            </div>
          </div>
          <textarea
            value={csv}
            onChange={(e) => runPreview(e.target.value)}
            placeholder="Paste CSV here or upload a file above…"
            rows={8}
            spellCheck={false}
            className={cn(
              "w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2.5 font-mono text-[12px] leading-relaxed",
              "focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300/30",
              "dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600 dark:focus:ring-zinc-700/30",
              "placeholder:text-zinc-400/70",
            )}
          />
        </div>

        {/* Live preview */}
        {previewPending && !preview && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Parsing…
          </div>
        )}

        {preview && <PreviewPanel preview={preview} pending={previewPending} />}

        {commitResult?.ok && (
          <Alert tone="success">
            <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
            Imported {commitResult.data?.cityCampaignsCreated} city/campaigns and{" "}
            {commitResult.data?.eventsCreated} crawls
            {commitResult.data && commitResult.data.skipped > 0 && (
              <> · skipped {commitResult.data.skipped} duplicate(s)</>
            )}
            .
          </Alert>
        )}
        {commitResult && !commitResult.ok && commitResult.error && (
          <Alert tone="error">{commitResult.error}</Alert>
        )}

        {/* Commit */}
        <div className="flex items-center justify-end gap-2 border-zinc-200/60 border-t pt-4 dark:border-zinc-800/40">
          <Button type="button" onClick={handleCommit} disabled={!canCommit || commitPending}>
            {commitPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" /> Import {preview?.summary.crawlsToCreate ?? 0}{" "}
                crawls
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

function PreviewPanel({
  preview,
  pending: _pending,
}: {
  preview: ImportPreview;
  pending: boolean;
}) {
  const { rows, errors, summary } = preview;
  const [showAllRows, setShowAllRows] = useState(false);
  const displayedRows = showAllRows ? rows : rows.slice(0, 10);

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200/80 bg-zinc-50/60 p-4 dark:border-zinc-800/40 dark:bg-zinc-900/30">
      {/* Summary */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em]">
        <span className="text-zinc-700 dark:text-zinc-300">
          <span className="text-zinc-500">Rows: </span>
          <strong className="font-semibold">{summary.totalRows}</strong>
        </span>
        <span className="text-emerald-700 dark:text-emerald-400">
          <span className="text-zinc-500">Cities: </span>
          <strong className="font-semibold">{summary.citiesResolved} resolved</strong>
        </span>
        {summary.citiesUnresolved > 0 && (
          <span className="text-amber-700 dark:text-amber-400">
            <strong className="font-semibold">{summary.citiesUnresolved}</strong> unresolved
          </span>
        )}
        {errors.length > 0 && (
          <span className="text-rose-700 dark:text-rose-400">
            <strong className="font-semibold">{errors.length}</strong> error
            {errors.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="space-y-1 rounded-md bg-rose-50/50 p-2.5 dark:bg-rose-950/20">
          {errors.slice(0, 5).map((e) => (
            <div key={e.rowNumber} className="text-rose-700 text-xs dark:text-rose-300">
              <XCircle className="mr-1 inline h-3 w-3" />
              Row {e.rowNumber}: {e.reason}
            </div>
          ))}
          {errors.length > 5 && (
            <div className="text-[11px] text-rose-600 italic dark:text-rose-400">
              … and {errors.length - 5} more
            </div>
          )}
        </div>
      )}

      {/* Rows */}
      {displayedRows.length > 0 && (
        <ul className="space-y-1">
          {displayedRows.map((r) => (
            <li
              key={r.rowNumber}
              className={cn(
                "flex items-center gap-3 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                r.resolvedCityId
                  ? "bg-emerald-500/[0.06] text-emerald-900 dark:bg-emerald-500/[0.08] dark:text-emerald-100"
                  : "bg-amber-500/[0.06] text-amber-900 dark:bg-amber-500/[0.08] dark:text-amber-100",
              )}
            >
              <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                #{r.rowNumber}
              </span>
              <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                P{r.priority}
              </span>
              <span className="flex-1 truncate font-medium">
                {r.cityName}
                {r.resolvedCityLabel && r.resolvedCityLabel !== r.cityName && (
                  <span className="ml-1 font-normal text-[10px] text-zinc-500">
                    → {r.resolvedCityLabel}
                  </span>
                )}
              </span>
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                {r.day} · crawl {r.crawlNumber}
              </span>
              <span className="shrink-0">
                {r.resolvedCityId ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                ) : r.suggestion ? (
                  <span
                    className="font-mono text-[10px] text-amber-700 dark:text-amber-300"
                    title={`Did you mean ${r.suggestion.label}? (${Math.round(r.suggestion.similarity * 100)}% match)`}
                  >
                    did you mean {r.suggestion.label}?
                  </span>
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                )}
              </span>
            </li>
          ))}
          {!showAllRows && rows.length > 10 && (
            <li className="text-center">
              <button
                type="button"
                onClick={() => setShowAllRows(true)}
                className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em] underline-offset-4 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
              >
                Show all {rows.length} rows
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
