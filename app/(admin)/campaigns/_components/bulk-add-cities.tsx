"use client";

/**
 * BulkAddCities — three-mode panel for adding cities to a campaign.
 *
 * Per operator session 11 decision #026:
 *   "When you add a campaign you should be able to add cities, and in
 *    add cities you should be able to add all or to upload the csv
 *    files with the city names that matches it to the database even
 *    if slightly wrong or formatted differently."
 *
 * Modes
 * -----
 * 1. **Add all** — one click to add every available city not yet in
 *    the campaign (priority defaults to 5). Confirms count + lists
 *    the skip count before committing.
 *
 * 2. **CSV** — paste a list (one city per line, optional
 *    `name,priority` or `name,region,priority`). Two-stage flow:
 *      a) Preview — server returns match classification per row:
 *         'high' (auto-accept), 'ambiguous' (operator picks a
 *         candidate), 'not_found' (skipped).
 *      b) Commit — server inserts the high-confidence + operator-
 *         resolved cities.
 *    No confirmation needed for high-confidence rows; the operator
 *    just sees them listed and clicks Commit.
 *
 * 3. **Manual** — preserved from the original UI. Search-as-you-type
 *    a single city. Useful when adding 1-2 cities in flight.
 *
 * The component is collapsed by default — a single "Add cities"
 * trigger reveals the tab bar.
 */

import {
  addAllCitiesToCampaign,
  commitBulkCityImport,
  previewCsvCityImport,
} from "@/app/(admin)/city-campaigns/_actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Plus,
  Upload,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";

interface CityOption {
  id: string;
  name: string;
  region: string | null;
}

interface Props {
  campaignId: string;
  unassignedCities: CityOption[];
  /** Render slot for the manual one-by-one add form (existing component). */
  renderManualForm: () => React.ReactNode;
}

type Tab = "all" | "csv" | "manual";

interface PreviewRow {
  rawInput: string;
  confidence: "high" | "ambiguous" | "not_found";
  candidates: Array<{ id: string; name: string; region: string | null }>;
  priority: number | null;
  matchedOn?: string;
  /** Operator's pick for ambiguous rows. Defaults to first candidate. */
  selectedCandidateId?: string;
}

export function BulkAddCities({ campaignId, unassignedCities, renderManualForm }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");

  return (
    <Card className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="-mx-1 flex items-center justify-between rounded-md px-1 py-1 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-zinc-500" />
          <span className="font-medium text-sm">Add cities</span>
          <span className="text-xs text-zinc-500">
            {unassignedCities.length} not yet in this campaign
          </span>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-zinc-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-zinc-200 border-t pt-3 dark:border-zinc-800">
          {/* Tab bar */}
          <div className="flex items-center gap-1">
            <TabButton current={tab} value="all" onClick={() => setTab("all")}>
              Add all
            </TabButton>
            <TabButton current={tab} value="csv" onClick={() => setTab("csv")}>
              Upload CSV
            </TabButton>
            <TabButton current={tab} value="manual" onClick={() => setTab("manual")}>
              One at a time
            </TabButton>
          </div>

          {tab === "all" && (
            <AddAllPanel campaignId={campaignId} availableCount={unassignedCities.length} />
          )}
          {tab === "csv" && <CsvPanel campaignId={campaignId} />}
          {tab === "manual" && <div>{renderManualForm()}</div>}
        </div>
      )}
    </Card>
  );
}

function TabButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 font-medium text-xs transition-colors",
        active
          ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

// =========================================================================
// Add all
// =========================================================================

function AddAllPanel({
  campaignId,
  availableCount,
}: {
  campaignId: string;
  availableCount: number;
}) {
  const [pending, startTx] = useTransition();
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleAddAll() {
    setError(null);
    setResult(null);
    startTx(async () => {
      const r = await addAllCitiesToCampaign(campaignId);
      if (!r.ok) {
        setError(r.error ?? "Couldn't add cities.");
        return;
      }
      setResult(r.data);
    });
  }

  if (result) {
    return (
      <SuccessBanner>
        Added {result.added} {result.added === 1 ? "city" : "cities"} to this campaign.
        {result.skipped > 0 && ` Skipped ${result.skipped} already in the campaign.`}
      </SuccessBanner>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Adds every city in the master list that's not already in this campaign. Priority defaults to
        5; you can adjust per-city after.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleAddAll}
          disabled={pending || availableCount === 0}
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {pending
            ? "Adding…"
            : availableCount === 0
              ? "All cities already in this campaign"
              : `Add ${availableCount} ${availableCount === 1 ? "city" : "cities"}`}
        </Button>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </div>
  );
}

// =========================================================================
// CSV upload
// =========================================================================

function CsvPanel({ campaignId }: { campaignId: string }) {
  const [text, setText] = useState("");
  const [previewing, startPreview] = useTransition();
  const [committing, startCommit] = useTransition();
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [meta, setMeta] = useState<{ alreadyInCampaign: number; totalCities: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<{ added: number; skipped: number } | null>(null);
  /**
   * Drag-and-drop state for the CSV drop zone. Tracks whether a file
   * is currently hovering over the zone so we can apply a hover style
   * (highlighted border + tint). The browser fires dragenter/dragleave
   * multiple times as the pointer crosses child boundaries; we increment
   * /decrement a counter rather than toggle a boolean to avoid flicker.
   */
  const [dragDepth, setDragDepth] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Read an uploaded CSV/text file into the textarea. We treat the
   * file as plain UTF-8 text — anything beyond that (xlsx, gzipped,
   * non-UTF-8) is rejected with a clear message so the operator
   * doesn't get a silent garbage import.
   *
   * Supported extensions: .csv, .txt, .tsv. Other extensions hit
   * the rejection path so the operator can re-export from their
   * spreadsheet tool. (Most spreadsheet tools "Save As CSV" works.)
   *
   * File size limit: 1 MB. Real bulk-add datasets for this app are
   * <1000 lines = ~30 KB; anything larger is almost certainly a
   * pasted wrong-file. We refuse politely rather than freeze the
   * tab on a 50 MB file.
   */
  function handleFile(file: File) {
    setError(null);
    setCommitResult(null);

    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    const allowedExts = ["csv", "txt", "tsv"];
    if (!allowedExts.includes(ext)) {
      setError(
        `Unsupported file type: .${ext}. Re-export as CSV/TXT/TSV from your spreadsheet tool.`,
      );
      return;
    }

    const ONE_MB = 1024 * 1024;
    if (file.size > ONE_MB) {
      setError(
        `File is ${(file.size / ONE_MB).toFixed(1)} MB — over the 1 MB limit. Most bulk imports are under 30 KB.`,
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      // Normalize line endings: Windows \r\n → \n. Otherwise the parser
      // sees " ON\r" as a region name with trailing \r — silent bad data.
      // Also strip BOM if present (Excel exports occasionally include
      // U+FEFF at the start of UTF-8 CSVs).
      const normalized = content
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
      setText(normalized);
    };
    reader.onerror = () => {
      setError("Could not read file. Try pasting the contents directly instead.");
    };
    reader.readAsText(file);
  }

  function handlePreview() {
    setError(null);
    setCommitResult(null);
    startPreview(async () => {
      const r = await previewCsvCityImport(campaignId, text);
      if (!r.ok) {
        setError(r.error ?? "Preview failed.");
        return;
      }
      // Default each ambiguous row's pick to its first candidate so
      // the operator only has to override the wrong ones, not pick
      // every right one.
      setRows(
        r.data.rows.map((row) => ({
          ...row,
          selectedCandidateId: row.candidates[0]?.id,
        })),
      );
      setMeta({
        alreadyInCampaign: r.data.alreadyInCampaign,
        totalCities: r.data.totalCities,
      });
    });
  }

  function updateSelected(rawInput: string, candidateId: string) {
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.rawInput === rawInput ? { ...r, selectedCandidateId: candidateId } : r,
          )
        : prev,
    );
  }

  function handleCommit() {
    if (!rows) return;
    setError(null);
    const picks = rows.flatMap<{ cityId: string; priority: number | null }>((r) => {
      if (r.confidence === "not_found" || !r.selectedCandidateId) return [];
      return [{ cityId: r.selectedCandidateId, priority: r.priority }];
    });
    if (picks.length === 0) {
      setError("Nothing to import.");
      return;
    }
    startCommit(async () => {
      const r = await commitBulkCityImport(campaignId, picks);
      if (!r.ok) {
        setError(r.error ?? "Import failed.");
        return;
      }
      setCommitResult(r.data);
      // Clear preview so subsequent imports start fresh
      setRows(null);
      setText("");
    });
  }

  if (commitResult) {
    return (
      <SuccessBanner>
        Imported {commitResult.added} {commitResult.added === 1 ? "city" : "cities"}.
        {commitResult.skipped > 0 && ` Skipped ${commitResult.skipped} (already in campaign).`}
        <button
          type="button"
          onClick={() => setCommitResult(null)}
          className="ml-2 text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300"
        >
          Import more
        </button>
      </SuccessBanner>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Paste a list of cities (one per line) or drop a CSV file below. Optional second column =
        region; optional last column = priority 1-10. Slight misspellings are matched automatically.
      </p>

      {/* Drop zone wrapping the textarea. dragenter / dragleave fire on
          every child element transition, so we use a counter (dragDepth)
          and treat any non-zero value as "hovering" — this avoids flicker
          when the pointer crosses from textarea to the surrounding div. */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) {
            setDragDepth((d) => d + 1);
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragDepth((d) => Math.max(0, d - 1));
        }}
        onDragOver={(e) => {
          // Required to allow drop; without this the browser refuses
          // the operation and the cursor shows "not allowed".
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragDepth(0);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        className={cn(
          "relative rounded-md transition-colors",
          dragDepth > 0 &&
            "ring-2 ring-blue-500/40 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950",
        )}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Toronto, ON\nBuffalo, NY, 3\nNew York\nChicago, IL, 7"}
          rows={6}
          className={cn(
            "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs",
            "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
            "dark:border-zinc-700 dark:bg-zinc-900",
          )}
        />
        {/* Drop overlay — appears over the textarea while a file is being
            dragged over. We pointer-events-none on it so the underlying
            textarea still receives the drop event. */}
        {dragDepth > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-blue-500/[0.06] backdrop-blur-[2px] dark:bg-blue-500/[0.08]">
            <div className="flex flex-col items-center gap-1 font-mono text-[11px] text-blue-700 uppercase tracking-[0.08em] dark:text-blue-300">
              <FileText className="h-5 w-5" />
              Drop CSV to import
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input — clicked by the "Choose file" button below
          so we don't need a styled <input type=file> which is famously
          hard to align with the design system. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          // Reset so re-selecting the same file fires onChange again
          e.target.value = "";
        }}
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileText className="h-3 w-3" />
          Choose CSV file
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handlePreview}
          disabled={previewing || !text.trim()}
        >
          {previewing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          {previewing ? "Matching…" : "Preview matches"}
        </Button>
        {rows && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setRows(null);
              setError(null);
            }}
          >
            Reset
          </Button>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {rows && meta && <PreviewList rows={rows} meta={meta} onUpdate={updateSelected} />}

      {rows?.some((r) => r.confidence !== "not_found") && (
        <div className="flex items-center gap-2 border-zinc-200 border-t pt-3 dark:border-zinc-800">
          <Button type="button" size="sm" onClick={handleCommit} disabled={committing}>
            {committing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            {committing ? "Importing…" : "Import resolved cities"}
          </Button>
          <span className="text-xs text-zinc-500">
            {rows.filter((r) => r.confidence === "high").length} auto ·{" "}
            {rows.filter((r) => r.confidence === "ambiguous").length} ambiguous ·{" "}
            {rows.filter((r) => r.confidence === "not_found").length} not found
          </span>
        </div>
      )}
    </div>
  );
}

function PreviewList({
  rows,
  meta,
  onUpdate,
}: {
  rows: PreviewRow[];
  meta: { alreadyInCampaign: number; totalCities: number };
  onUpdate: (rawInput: string, candidateId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-zinc-500">
        {rows.length} row{rows.length === 1 ? "" : "s"} parsed · {meta.alreadyInCampaign} already in
        campaign · {meta.totalCities} cities in master list
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.rawInput}
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              row.confidence === "high"
                ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/30"
                : row.confidence === "ambiguous"
                  ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/30"
                  : "border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/60",
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{row.rawInput}</span>
              <span
                className={cn(
                  "font-mono text-[9px] uppercase tracking-[0.12em]",
                  row.confidence === "high"
                    ? "text-emerald-700 dark:text-emerald-400"
                    : row.confidence === "ambiguous"
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-zinc-500",
                )}
              >
                {row.confidence === "high"
                  ? `match · ${row.matchedOn ?? ""}`
                  : row.confidence === "ambiguous"
                    ? "needs review"
                    : "not found"}
              </span>
            </div>
            {row.confidence === "high" && row.candidates[0] && (
              <div className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                → {row.candidates[0].name}
                {row.candidates[0].region && `, ${row.candidates[0].region}`}
                {row.priority != null && (
                  <span className="ml-2 text-zinc-400">priority {row.priority}</span>
                )}
              </div>
            )}
            {row.confidence === "ambiguous" && row.candidates.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {row.candidates.map((c) => {
                  const picked = c.id === row.selectedCandidateId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onUpdate(row.rawInput, c.id)}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                        picked
                          ? "border-amber-500 bg-amber-200/60 font-medium text-amber-900 dark:border-amber-400 dark:bg-amber-900/40 dark:text-amber-100"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                      )}
                    >
                      {c.name}
                      {c.region && `, ${c.region}`}
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SuccessBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-emerald-800 text-xs dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50/80 px-3 py-2 text-rose-800 text-xs dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
