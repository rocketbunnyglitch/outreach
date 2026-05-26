"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { VenueImportSummary } from "@/lib/validation/csv-import";
import { AlertCircle, CheckCircle2, FileDown } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

interface Props {
  action: (
    prev: unknown,
    fd: FormData,
  ) => Promise<{ ok: boolean; summary?: VenueImportSummary; error?: string }>;
}

/**
 * Client form for CSV upload + per-row import results display.
 *
 * Uses native file input — no fancy drag-and-drop yet (KISS for Phase 4b).
 * Keeps the form action stateless: each submission is a fresh import.
 */
export function VenueImportForm({ action }: Props) {
  const [state, formAction] = useActionState(action, null);

  return (
    <div className="flex flex-col gap-6">
      <SampleCsvLink />

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-5 dark:border-zinc-800">
          <label htmlFor="csv" className="font-medium text-sm">
            Upload CSV
          </label>
          <input
            id="csv"
            name="csv"
            type="file"
            accept=".csv,text/csv"
            required
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:font-medium file:text-sm hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:hover:file:bg-zinc-700"
          />
          <p className="text-xs text-zinc-500">
            Required columns: <code className="font-mono">name</code>,{" "}
            <code className="font-mono">city</code>. Optional:{" "}
            <code className="font-mono">country</code>, <code className="font-mono">address</code>,{" "}
            <code className="font-mono">phone</code> (E.164),{" "}
            <code className="font-mono">email</code>, <code className="font-mono">website</code>,{" "}
            <code className="font-mono">instagram</code>,{" "}
            <code className="font-mono">capacity</code>,{" "}
            <code className="font-mono">serves_alcohol</code>,{" "}
            <code className="font-mono">dnc</code>, <code className="font-mono">notes</code>.
          </p>
        </div>
        <SubmitButton />
      </form>

      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && state.summary && <ImportResults summary={state.summary} />}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="self-end">
      {pending ? "Importing…" : "Import venues"}
    </Button>
  );
}

function ImportResults({ summary }: { summary: VenueImportSummary }) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <header className="flex flex-wrap items-baseline gap-4">
        <h2 className="font-semibold text-2xl tracking-tight ">Import complete</h2>
        <div className="flex items-center gap-4 font-mono text-xs">
          <span className="text-zinc-500">{summary.totalRows} rows · </span>
          {summary.inserted > 0 && (
            <span className="text-emerald-700 dark:text-emerald-400">
              {summary.inserted} imported
            </span>
          )}
          {summary.errors > 0 && (
            <span className="text-rose-700 dark:text-rose-400">{summary.errors} errors</span>
          )}
          {summary.skipped > 0 && <span className="text-zinc-500">{summary.skipped} skipped</span>}
        </div>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead className="text-left text-xs text-zinc-500 uppercase tracking-wider">
          <tr className="border-zinc-200 border-b dark:border-zinc-800">
            <th className="py-2 pr-4">Row</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {summary.results.map((r) => (
            <tr key={r.rowIndex} className="border-zinc-100 border-b dark:border-zinc-900">
              <td className="py-2 pr-4 font-mono text-xs text-zinc-500">{r.rowIndex}</td>
              <td className="py-2 pr-4">
                {r.status === "ok" && (
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Imported
                  </span>
                )}
                {r.status === "error" && (
                  <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                    <AlertCircle className="h-3 w-3" /> Error
                  </span>
                )}
                {r.status === "skipped" && <span className="text-zinc-500">Skipped</span>}
              </td>
              <td className="py-2 text-xs text-zinc-600 dark:text-zinc-400">
                {r.message ??
                  (r.venueId ? (
                    <a
                      className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
                      href={`/venues/${r.venueId}`}
                    >
                      view venue →
                    </a>
                  ) : null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function SampleCsvLink() {
  const sample = `name,city,country,address,phone,email,capacity,serves_alcohol,dnc,notes
The Drake Hotel,Toronto,Canada,"1150 Queen St W, Toronto",+14165315042,events@thedrakehotel.ca,250,yes,no,Anchor venue
Bar Volo,Toronto,Canada,612 Yonge St,,,80,yes,no,
Caffeine Cathedral,London,United Kingdom,12 Old Compton St,,hello@caffeinecathedral.co.uk,40,no,no,No alcohol — coffee only
`;
  const blob =
    typeof window !== "undefined"
      ? URL.createObjectURL(new Blob([sample], { type: "text/csv" }))
      : "";
  return (
    <a
      href={blob}
      download="venues-import-sample.csv"
      className="inline-flex items-center gap-2 self-start text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
    >
      <FileDown className="h-3 w-3" />
      Download sample CSV
    </a>
  );
}
