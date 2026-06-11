"use client";

import { cn } from "@/lib/cn";
import { Loader2, PhoneCall } from "lucide-react";
import { useState, useTransition } from "react";
import { logCallAttempt } from "../../_actions/quo-actions";
import { CallOutcomePopover } from "./call-outcome-popover";

interface Props {
  venueId: string;
  venueName: string;
  venuePhone: string | null;
  outreachBrandId: string | null;
  cityCampaignId: string;
  coldEntryId: string;
  /** Optional — used to surface the "Best call window" hint inside
   *  the post-call outcome popover. Both fields come from the
   *  cold-outreach row so this is just pass-through. */
  venueHours?: string | null;
  venueType?: readonly string[];
  /** IANA timezone for the venue's city (e.g. "America/Toronto").
   *  Pass-through to the popover so its "currently open?" check
   *  reflects the venue's local time, not the browser's. */
  venueTimezone?: string;
  /** Layout mode:
   *   - "inline" (default): everything in a single horizontal row
   *     (legacy shape, still used by the city-sheet event slots).
   *   - "stacked": phone number on its own line, action icons stacked
   *     vertically beneath it. Used by the cold-outreach table where
   *     column width matters and the operator wanted the long phone
   *     numbers + icons to stop fighting each other for space. */
  layout?: "inline" | "stacked";
  /** When in "stacked" layout, the Tailwind text-size class applied
   *  to the phone number so callers can shrink the font for long
   *  international numbers without wrapping. Ignored in "inline" mode. */
  phoneFontClass?: string;
}

/**
 * Quo dial controls for one cold-outreach row.
 *
 * One affordance when a phone number is present:
 *   • Phone icon — click-to-call. Opens tel:+1234… and in parallel
 *     fires logCallAttempt which writes an outreach_log entry + bumps
 *     the cold outreach entry's status & last_touch_at. The eventual
 *     call outcome (voicemail / no-answer / completed) lands via the
 *     Quo webhook handler when Quo notifies us.
 *
 * Without a phone number: shows a quiet dash (no action available).
 * Without an outreach brand attached to the campaign: button shows
 * but warns the operator to set the brand first.
 */
export function QuoDialControls({
  venueId,
  venueName,
  venuePhone,
  outreachBrandId,
  cityCampaignId,
  coldEntryId,
  venueHours,
  venueType,
  venueTimezone,
  layout = "inline",
  phoneFontClass,
}: Props) {
  const [calling, startCall] = useTransition();
  // The placeholder log id from the click — passed to the outcome
  // popover so saving the result updates the same row instead of
  // creating a duplicate.
  const [pendingCallLogId, setPendingCallLogId] = useState<string | null>(null);
  // Tracks whether the outcome popover should be visible.
  const [outcomeOpen, setOutcomeOpen] = useState(false);

  if (!venuePhone) {
    return <span className="font-mono text-[10px] text-zinc-400">—</span>;
  }

  function handleCall() {
    if (!outreachBrandId) {
      window.open(`tel:${venuePhone}`, "_self");
      return;
    }
    const fd = new FormData();
    fd.set("venueId", venueId);
    fd.set("outreachBrandId", outreachBrandId);
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("coldEntryId", coldEntryId);
    startCall(async () => {
      const result = await logCallAttempt(null, fd);
      if (result.ok && result.data) {
        setPendingCallLogId(result.data.logId);
        // Show the outcome popover so the operator captures the result
        // as the call progresses. They can dismiss without saving if
        // it was a mis-tap.
        setOutcomeOpen(true);
      }
    });
    // Open the dialer simultaneously — tel: hands off to the device's
    // phone app / OpenPhone desktop / iPhone hand-off
    window.open(`tel:${venuePhone}`, "_self");
  }

  // -----------------------------------------------------------------
  // Stacked layout — phone number on its own line, action icons in a
  // HORIZONTAL row beneath it (was vertical column previously, which
  // wasted column width). The caller picks the font size for the phone
  // string based on length so long international numbers still fit on
  // a single line without wrapping.
  // -----------------------------------------------------------------
  if (layout === "stacked") {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={handleCall}
          disabled={calling}
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1 py-0.5 font-mono text-zinc-700 leading-none transition-colors hover:bg-blue-500/[0.08] hover:text-blue-700 dark:text-zinc-300 dark:hover:text-blue-300",
            phoneFontClass ?? "text-xs",
          )}
          title={`Dial ${venuePhone}`}
        >
          {calling ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : (
            <PhoneCall className="h-3 w-3 shrink-0" />
          )}
          <span>{venuePhone}</span>
        </button>

        {outcomeOpen && pendingCallLogId && outreachBrandId && (
          <CallOutcomePopover
            logId={pendingCallLogId}
            venueId={venueId}
            venueName={venueName}
            outreachBrandId={outreachBrandId}
            cityCampaignId={cityCampaignId}
            coldEntryId={coldEntryId}
            venueHours={venueHours ?? null}
            venueType={venueType ?? []}
            venueTimezone={venueTimezone ?? "America/Toronto"}
            onClose={() => {
              setOutcomeOpen(false);
              setPendingCallLogId(null);
            }}
          />
        )}
      </div>
    );
  }

  // -----------------------------------------------------------------
  // Inline layout — legacy single-row shape; still used in places
  // where the column has horizontal room (event slot popovers, etc.)
  // -----------------------------------------------------------------
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleCall}
        disabled={calling}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-600 transition-colors hover:bg-blue-500/[0.08] hover:text-blue-700 dark:text-zinc-400 dark:hover:text-blue-300"
        title={`Dial ${venuePhone}`}
      >
        {calling ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : (
          <PhoneCall className="h-2.5 w-2.5" />
        )}
        <span className="hidden sm:inline">{venuePhone}</span>
      </button>
      {outcomeOpen && pendingCallLogId && outreachBrandId && (
        <CallOutcomePopover
          logId={pendingCallLogId}
          venueId={venueId}
          venueName={venueName}
          outreachBrandId={outreachBrandId}
          cityCampaignId={cityCampaignId}
          coldEntryId={coldEntryId}
          venueHours={venueHours}
          venueType={venueType}
          venueTimezone={venueTimezone}
          onClose={() => {
            setOutcomeOpen(false);
            setPendingCallLogId(null);
          }}
        />
      )}
    </div>
  );
}

// SMS composer removed 2026-06-11 (operator: texting does not work with
// Quo). sendQuoSmsToVenue remains server-side; reintroduce a trigger
// here if Quo texting ever ships.

// Viber buttons removed 2026-06-10 (operator request: remove all Viber
// icons). lib/viber.ts + logViberAttempt remain server-side for the
// historical channel data; reintroduce a button here if Viber returns.
