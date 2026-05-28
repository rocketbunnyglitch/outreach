import { Package } from "lucide-react";
import {
  type WristbandRowData,
  WristbandShippingRow,
} from "../../wristbands/_components/wristband-shipping-row";

/**
 * Wristband shipping for a venue — shown on the venue detail page only when the
 * venue is a wristband venue on at least one crawl. Reuses the same editable
 * row as /wristbands, so edits here sync straight to the wristband tracker.
 */
export function VenueWristbandSection({ rows }: { rows: WristbandRowData[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 font-semibold text-2xl tracking-tight">
          <Package className="h-5 w-5 text-zinc-400" /> Wristband shipping
        </h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          This venue is the wristband venue on {rows.length} crawl
          {rows.length === 1 ? "" : "s"}. Set shipment status + tracking here — it syncs to the
          wristband tracker.
        </p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-zinc-200/80 dark:border-zinc-800/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
              <th className="px-4 py-2.5">Crawl</th>
              <th className="px-4 py-2.5">Recipient</th>
              <th className="px-4 py-2.5">Shipping</th>
              <th className="px-4 py-2.5">Tracking</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="w-10 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <WristbandShippingRow key={r.venueEventId} row={r} striped={i % 2 === 1} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
