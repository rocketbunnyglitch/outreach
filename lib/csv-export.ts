/**
 * Client-side CSV export. Serializes rows to a CSV string and triggers a
 * browser download — CSV opens natively in Google Sheets, Excel and Numbers,
 * so one format covers "sheets / csv / excel".
 *
 * No `server-only`, no db — a plain util safe to import from client
 * components (the table export buttons) or server code alike.
 *
 * CSV-injection guard: a cell whose first character is = + - @ is prefixed
 * with a single quote so a spreadsheet app doesn't evaluate it as a live
 * formula (e.g. a venue literally named "=HYPERLINK(...)"). Same guard as
 * scripts/backup-to-sheets.ts csvCell.
 */

export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const head = headers.map(csvCell).join(",");
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return body ? `${head}\r\n${body}` : head;
}

/**
 * Build a CSV from headers + rows and download it as `filename`. A leading
 * UTF-8 BOM is prepended so Excel renders accented venue names correctly.
 * Browser-only (uses Blob/URL/document) — call from an event handler, never
 * during render.
 */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const csv = toCsv(headers, rows);
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Slugify a label for use in a download filename ("New York" -> "new-york"). */
export function filenameSlug(label: string | null | undefined): string {
  return (label ?? "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
