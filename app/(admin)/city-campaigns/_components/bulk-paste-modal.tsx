"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { AlertTriangle, Check, ClipboardPaste, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { bulkPasteVenues } from "../_cold-outreach-actions";

/**
 * Bulk paste preview modal.
 *
 * Operator copies rows from Google Sheets (or anywhere — TSV format with
 * tab-separated columns + newline rows). We parse it client-side, run
 * column heuristics to figure out which column is name vs email vs
 * phone, show a preview, and submit on confirm.
 *
 * Column heuristics:
 *   - Email column: contains '@' in 2+ cells
 *   - Phone column: contains 7+ digits + optional + in 2+ cells
 *   - Name column: the first remaining non-empty column
 *
 * Operator can override the column mapping via dropdowns at the top of
 * each column. Rows with malformed data show a warning chip but don't
 * block the import — the server validates per-row and counts skips.
 */

interface PastedRow {
  cells: string[];
}

type ColumnKind = "name" | "email" | "phone" | "ignore";

export function BulkPasteModal({
  open,
  rawTsv,
  cityCampaignId,
  cityId,
  onClose,
}: {
  open: boolean;
  rawTsv: string;
  cityCampaignId: string;
  cityId: string;
  onClose: () => void;
}) {
  const [pending, startTx] = useTransition();
  const toast = useToast();

  // Parse the TSV into rows + cells. Strip a header row if it looks
  // like one (cells match field name keywords).
  const parsed = useMemo(() => parseTsv(rawTsv), [rawTsv]);

  // Column mapping — auto-detect, then operator can override
  const initialMapping = useMemo(() => detectColumns(parsed.rows), [parsed.rows]);
  const [mapping, setMapping] = useState<ColumnKind[]>(initialMapping);

  // Re-detect when the TSV changes (modal reopens with new clipboard)
  useEffect(() => {
    setMapping(initialMapping);
  }, [initialMapping]);

  // Build the row payload from current mapping
  const previewRows = useMemo(() => {
    const nameIdx = mapping.indexOf("name");
    const emailIdx = mapping.indexOf("email");
    const phoneIdx = mapping.indexOf("phone");
    return parsed.rows.map((row, i) => ({
      key: i,
      name: nameIdx >= 0 ? (row.cells[nameIdx]?.trim() ?? "") : "",
      email: emailIdx >= 0 ? (row.cells[emailIdx]?.trim() ?? "") : "",
      phone: phoneIdx >= 0 ? (row.cells[phoneIdx]?.trim() ?? "") : "",
    }));
  }, [parsed.rows, mapping]);

  // Per-row validity for the warning chips
  const validity = useMemo(() => {
    return previewRows.map((r) => {
      if (!r.name) return { ok: false, issue: "missing name" };
      if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
        return { ok: false, issue: "bad email" };
      }
      if (r.phone) {
        const stripped = r.phone.replace(/[\s\-().]/g, "");
        if (!/^\+?[1-9]\d{6,14}$/.test(stripped)) {
          return { ok: false, issue: "bad phone" };
        }
      }
      return { ok: true, issue: null };
    });
  }, [previewRows]);

  const validCount = validity.filter((v) => v.ok).length;
  const invalidCount = validity.length - validCount;
  const hasNameColumn = mapping.includes("name");

  function submit() {
    if (!hasNameColumn) {
      toast.show({
        kind: "error",
        message: "Pick a column to be the venue name before importing.",
      });
      return;
    }
    const payload = previewRows.filter((_, i) => validity[i]?.ok);
    const fd = new FormData();
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("cityId", cityId);
    fd.set("rowsJson", JSON.stringify(payload));
    startTx(async () => {
      const result = await bulkPasteVenues(null, fd);
      if (!result.ok) {
        toast.show({ kind: "error", message: result.error ?? "Couldn't import." });
        return;
      }
      const { created, updated, skipped } = result.data ?? { created: 0, updated: 0, skipped: 0 };
      const parts: string[] = [];
      if (created) parts.push(`${created} new`);
      if (updated) parts.push(`${updated} updated`);
      if (skipped) parts.push(`${skipped} skipped`);
      toast.show({
        kind: "success",
        message: `Imported ${parts.join(" · ") || "0 rows"}`,
      });
      onClose();
    });
  }

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        tabIndex={-1}
        aria-label="Close"
        className="fixed inset-0 z-[140] cursor-default bg-zinc-900/40 backdrop-blur-sm"
      />
      <div className="fixed inset-0 z-[150] grid place-items-center p-4">
        <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <header className="flex items-center justify-between border-zinc-200 border-b px-5 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <ClipboardPaste className="h-4 w-4 text-zinc-500" />
              <h2 className="font-semibold tracking-tight">
                Bulk paste · {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
              </h2>
              {parsed.skippedHeader && (
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  · header row detected
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4">
            <p className="mb-3 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
              Map each column → field. Auto-detected from cell contents; override below.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-zinc-200/60 border-b dark:border-zinc-800/40">
                    {mapping.map((kind, colIdx) => (
                      <th
                        // biome-ignore lint/suspicious/noArrayIndexKey: column index is positional identity
                        key={colIdx}
                        className="px-2 py-2 text-left"
                      >
                        <select
                          value={kind}
                          onChange={(e) => {
                            const next = [...mapping];
                            next[colIdx] = e.target.value as ColumnKind;
                            setMapping(next);
                          }}
                          className="w-full rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                        >
                          <option value="ignore">— ignore —</option>
                          <option value="name">Venue name</option>
                          <option value="email">Email</option>
                          <option value="phone">Phone</option>
                        </select>
                      </th>
                    ))}
                    <th className="w-8 px-1 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 50).map((row, i) => {
                    const v = validity[i];
                    return (
                      <tr
                        // biome-ignore lint/suspicious/noArrayIndexKey: row index is positional identity
                        key={i}
                        className={cn(
                          "border-zinc-200/30 border-b dark:border-zinc-800/20",
                          !v?.ok && "bg-rose-50/30 dark:bg-rose-950/10",
                        )}
                      >
                        {row.cells.map((cell, ci) => (
                          <td
                            // biome-ignore lint/suspicious/noArrayIndexKey: cell index is positional identity
                            key={ci}
                            className={cn(
                              "max-w-[200px] truncate px-2 py-1.5 font-mono text-[11px]",
                              mapping[ci] === "ignore"
                                ? "text-zinc-400"
                                : "text-zinc-700 dark:text-zinc-300",
                            )}
                            title={cell}
                          >
                            {cell || <span className="text-zinc-400">—</span>}
                          </td>
                        ))}
                        <td className="px-1 py-1.5">
                          {v?.ok ? (
                            <Check className="h-3 w-3 text-emerald-500" aria-label="OK" />
                          ) : (
                            <AlertTriangle
                              className="h-3 w-3 text-amber-500"
                              aria-label={v?.issue ?? "Invalid"}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {parsed.rows.length > 50 && (
                <p className="mt-2 text-center font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  Preview shows first 50 · {parsed.rows.length - 50} more will be imported
                </p>
              )}
            </div>
          </div>

          <footer className="flex items-center justify-between gap-3 border-zinc-200 border-t px-5 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.08em]">
              <span className="text-emerald-600 dark:text-emerald-400">{validCount} valid</span>
              {invalidCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {invalidCount} will be skipped
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={onClose} variant="ghost" disabled={pending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending || validCount === 0 || !hasNameColumn}>
                {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Import {validCount}
              </Button>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

// =========================================================================
// TSV parsing + column heuristics
// =========================================================================

const HEADER_KEYWORDS = new Set([
  "name",
  "venue",
  "venue name",
  "business",
  "business name",
  "email",
  "e-mail",
  "phone",
  "phone number",
  "tel",
  "telephone",
  "mobile",
  "contact",
]);

function parseTsv(raw: string): { rows: PastedRow[]; skippedHeader: boolean } {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], skippedHeader: false };

  const rows: PastedRow[] = lines.map((line) => ({
    cells: line.split("\t").map((c) => c.replace(/^["']|["']$/g, "").trim()),
  }));

  // Header detection — first row's cells are all in HEADER_KEYWORDS (case-insensitive)
  const first = rows[0];
  if (first?.cells.every((c) => HEADER_KEYWORDS.has(c.toLowerCase()))) {
    return { rows: rows.slice(1), skippedHeader: true };
  }
  return { rows, skippedHeader: false };
}

function detectColumns(rows: PastedRow[]): ColumnKind[] {
  if (rows.length === 0) return [];
  const colCount = Math.max(...rows.map((r) => r.cells.length));
  const mapping: ColumnKind[] = Array(colCount).fill("ignore");

  // Score each column for each kind
  for (let col = 0; col < colCount; col++) {
    let emailHits = 0;
    let phoneHits = 0;
    let nonEmpty = 0;
    for (const r of rows) {
      const cell = (r.cells[col] ?? "").trim();
      if (!cell) continue;
      nonEmpty++;
      if (cell.includes("@") && cell.includes(".")) emailHits++;
      // Phone heuristic: 7+ digits, optionally prefixed with +
      const digits = cell.replace(/[^\d]/g, "");
      if (digits.length >= 7 && digits.length <= 15) phoneHits++;
    }
    const total = Math.max(nonEmpty, 1);
    if (emailHits / total > 0.5) mapping[col] = "email";
    else if (phoneHits / total > 0.5) mapping[col] = "phone";
  }

  // Pick the first un-mapped column as 'name' if no name column yet
  if (!mapping.includes("name")) {
    const idx = mapping.findIndex((k) => k === "ignore");
    if (idx >= 0) mapping[idx] = "name";
  }

  return mapping;
}
