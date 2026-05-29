"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { buildViberCallLink, buildViberChatLink } from "@/lib/viber";
import { Loader2, MessageCircle, MessageSquare, PhoneCall, Send, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { logCallAttempt, logViberAttempt, sendQuoSmsToVenue } from "../../_actions/quo-actions";
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
 * Two affordances when a phone number is present:
 *   • Phone icon — click-to-call. Opens tel:+1234… and in parallel
 *     fires logCallAttempt which writes an outreach_log entry + bumps
 *     the cold outreach entry's status & last_touch_at. The eventual
 *     call outcome (voicemail / no-answer / completed) lands via the
 *     Quo webhook handler when Quo notifies us.
 *   • SMS icon — pops a small composer with a 1600-char textarea.
 *     Sends via Quo API using the brand's quo_line_e164 as the from.
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
  const [smsOpen, setSmsOpen] = useState(false);
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
  // vertical column beneath it. Phone never wraps; the caller picks
  // the font size based on string length.
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

        <div className="flex flex-col items-start gap-0.5">
          <button
            type="button"
            onClick={() => setSmsOpen(true)}
            className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-emerald-500/[0.08] hover:text-emerald-600 dark:hover:text-emerald-400"
            aria-label="Send SMS via Quo"
            title="Send SMS via Quo"
          >
            <MessageSquare className="h-3 w-3" />
          </button>

          <ViberButton
            subtype="call"
            venueId={venueId}
            venuePhone={venuePhone}
            outreachBrandId={outreachBrandId}
            cityCampaignId={cityCampaignId}
            coldEntryId={coldEntryId}
          />
          <ViberButton
            subtype="chat"
            venueId={venueId}
            venuePhone={venuePhone}
            outreachBrandId={outreachBrandId}
            cityCampaignId={cityCampaignId}
            coldEntryId={coldEntryId}
          />
        </div>

        {smsOpen && (
          <SmsComposerPopover
            venueId={venueId}
            venueName={venueName}
            venuePhone={venuePhone}
            outreachBrandId={outreachBrandId}
            cityCampaignId={cityCampaignId}
            coldEntryId={coldEntryId}
            onClose={() => setSmsOpen(false)}
          />
        )}
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
      <button
        type="button"
        onClick={() => setSmsOpen(true)}
        className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-emerald-500/[0.08] hover:text-emerald-600 dark:hover:text-emerald-400"
        aria-label="Send SMS via Quo"
        title="Send SMS via Quo"
      >
        <MessageSquare className="h-2.5 w-2.5" />
      </button>

      {/* Viber call + chat — for venues in countries Quo can't service.
          Deep-links open the Viber app on the operator's device; the 2-3
          outreach staff share one Viber account. Logged with channel=
          'viber' in parallel so analytics capture every touch. */}
      <ViberButton
        subtype="call"
        venueId={venueId}
        venuePhone={venuePhone}
        outreachBrandId={outreachBrandId}
        cityCampaignId={cityCampaignId}
        coldEntryId={coldEntryId}
      />
      <ViberButton
        subtype="chat"
        venueId={venueId}
        venuePhone={venuePhone}
        outreachBrandId={outreachBrandId}
        cityCampaignId={cityCampaignId}
        coldEntryId={coldEntryId}
      />

      {smsOpen && (
        <SmsComposerPopover
          venueId={venueId}
          venueName={venueName}
          venuePhone={venuePhone}
          outreachBrandId={outreachBrandId}
          cityCampaignId={cityCampaignId}
          coldEntryId={coldEntryId}
          onClose={() => setSmsOpen(false)}
        />
      )}
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

function SmsComposerPopover({
  venueId,
  venueName,
  venuePhone,
  outreachBrandId,
  cityCampaignId,
  coldEntryId,
  onClose,
}: {
  venueId: string;
  venueName: string;
  venuePhone: string;
  outreachBrandId: string | null;
  cityCampaignId: string;
  coldEntryId: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, startSend] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentToast, setSentToast] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function send() {
    if (!body.trim() || !outreachBrandId) {
      setError(!outreachBrandId ? "No outreach brand attached." : "Type a message first.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("venueId", venueId);
    fd.set("outreachBrandId", outreachBrandId);
    fd.set("toE164", venuePhone);
    fd.set("body", body.trim());
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("coldEntryId", coldEntryId);
    startSend(async () => {
      const result = await sendQuoSmsToVenue(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Send failed.");
        return;
      }
      if (result.data && "notConfigured" in result.data) {
        setError(
          "Quo isn't configured — set QUO_API_KEY on the server, or use the dialer to copy the number.",
        );
        return;
      }
      setSentToast(true);
      setTimeout(onClose, 1400);
    });
  }

  return (
    <div
      ref={containerRef}
      className="absolute z-50 mt-1 w-80 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      style={{ marginLeft: "-2rem" }}
    >
      <header className="flex items-center justify-between border-zinc-200/60 border-b px-3 py-2 dark:border-zinc-800/40">
        <div>
          <p className="font-semibold text-xs tracking-tight">SMS to {venueName}</p>
          <p className="font-mono text-[10px] text-zinc-500">{venuePhone}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          aria-label="Close"
        >
          <X className="h-3 w-3" />
        </button>
      </header>
      <div className="p-3">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
          }}
          placeholder={`Hey ${venueName}, this is JC from…`}
          rows={4}
          maxLength={1600}
          className={cn(
            "w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs transition-colors",
            "placeholder:text-zinc-400/70 focus:border-zinc-400 focus:outline-none",
            "dark:border-zinc-800 dark:bg-zinc-950",
          )}
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
            {body.length}/1600
          </p>
          <Button type="button" size="sm" onClick={send} disabled={!body.trim() || sending}>
            {sending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Sending…
              </>
            ) : sentToast ? (
              <>Sent ✓</>
            ) : (
              <>
                <Send className="h-3 w-3" /> Send
              </>
            )}
          </Button>
        </div>
        {error && (
          <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One-tap Viber action button.
 *
 * Two subtypes:
 *   • call — opens viber://contact?number=... (Viber initiates call)
 *   • chat — opens viber://chat?number=...    (Viber opens chat thread)
 *
 * On click we open the deep link AND fire logViberAttempt in parallel
 * so analytics capture the touch even though Viber itself doesn't have
 * a webhook back to us (unlike Quo).
 *
 * Hidden when there's no venuePhone (nothing to dial) or no
 * outreachBrandId (we'd have no brand to attribute the attempt to —
 * extremely rare since the city campaign sets the brand).
 *
 * The icon is Viber's signature purple to distinguish it from Quo's
 * blue (call) and emerald (SMS) — quick visual scan tells the
 * operator which channel each row is using.
 */
function ViberButton({
  subtype,
  venueId,
  venuePhone,
  outreachBrandId,
  cityCampaignId,
  coldEntryId,
}: {
  subtype: "call" | "chat";
  venueId: string;
  venuePhone: string | null;
  outreachBrandId: string | null;
  cityCampaignId: string;
  coldEntryId: string;
}) {
  const [pending, startTx] = useTransition();
  if (!venuePhone || !outreachBrandId) return null;

  const link =
    subtype === "call"
      ? buildViberCallLink({ phoneE164: venuePhone })
      : buildViberChatLink({ phoneE164: venuePhone });
  if (!link) return null;

  function handleClick() {
    const fd = new FormData();
    fd.set("venueId", venueId);
    fd.set("outreachBrandId", outreachBrandId ?? "");
    fd.set("subtype", subtype);
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("coldEntryId", coldEntryId);
    startTx(async () => {
      await logViberAttempt(null, fd);
    });
    if (link) window.open(link, "_self");
  }

  const Icon = subtype === "call" ? PhoneCall : MessageCircle;
  const title = subtype === "call" ? "Viber call" : "Viber chat";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-purple-500/[0.08] hover:text-purple-600 dark:hover:text-purple-400"
      aria-label={title}
      title={title}
    >
      {pending ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <Icon className="h-2.5 w-2.5" />
      )}
    </button>
  );
}
