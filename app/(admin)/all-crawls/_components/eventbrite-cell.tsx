"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { linkEventbriteEvent, pushEventbriteDescription, syncEventbriteSales } from "../_actions";

interface Props {
  eventId: string;
  campaignId: string;
  currentEbId: string | null;
  currentEbUrl: string | null;
  ticketsSold: number;
  /** Hide the per-row sales-sync button (crawl cards, operator request
   *  2026-06-11): sales pull automatically at link time + every 15 min
   *  via the eventbrite-sync cron, and the tracker has a global
   *  Refresh-sales button — a per-card refresh is just noise there. */
  hideSync?: boolean;
}

/**
 * Eventbrite cell for the All Crawls table.
 *
 * Three states:
 *
 *   No linkage (currentEbId null):
 *     Quiet "Link" affordance → inline numeric input → save button.
 *     On save, server runs a city smart-check; if EB event's venue
 *     city ≠ crawl city, a confirm popover surfaces with both names.
 *
 *   Linked + idle:
 *     EB ID + external link icon, plus a compact action cluster:
 *       • Sync (pull sales from EB)
 *       • Push (send venue route to EB description)
 *       • Unlink (X)
 *
 *   Linked + acting:
 *     Loader2 inline, action result toast above the row.
 */
export function EventbriteCell({
  eventId,
  campaignId,
  currentEbId,
  currentEbUrl,
  ticketsSold,
  hideSync = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentEbId ?? "");
  const [linking, startLink] = useTransition();
  const [syncing, startSync] = useTransition();
  const [pushing, startPush] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const appToast = useToast();

  // Errors fire BOTH the inline marker and the app toast: in the
  // all-crawls table this cell is the LAST column of a horizontal
  // scroller, so a wide inline error can land in the scrolled-out
  // region off-screen (operator report 2026-06-11, twice). The toast
  // is unclippable; the inline marker stays compact for context.
  function showError(message: string) {
    setError(message);
    appToast.show({ kind: "error", message });
  }
  const [confirmMismatch, setConfirmMismatch] = useState<{
    eventCity: string;
    crawlCity: string;
    ebName: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(currentEbId ?? "");
  }, [currentEbId]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  function submitLink(force = false) {
    setError(null);
    setConfirmMismatch(null);
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("eventbriteEventId", draft.trim());
    fd.set("campaignId", campaignId);
    if (force) fd.set("force", "true");
    startLink(async () => {
      const result = await linkEventbriteEvent(null, fd);
      if (!result.ok) {
        showError(result.error ?? "Link failed.");
        return;
      }
      const data = result.data;
      if (!data) return;
      if ("notConfigured" in data) {
        showError("Eventbrite isn't configured — set EVENTBRITE_PRIVATE_TOKEN on the server.");
        return;
      }
      if ("needsConfirm" in data) {
        setConfirmMismatch({
          eventCity: data.mismatch.eventCity,
          crawlCity: data.mismatch.crawlCity,
          ebName: data.ebName,
        });
        // Also raise an unclippable toast: the confirm popover lives in
        // a table cell that can sit at a scrolled-out edge — without
        // this, the question can go unseen and the link "does nothing"
        // (operator report 2026-06-11).
        appToast.show({
          kind: "info",
          message: `"${data.ebName}" is in ${data.mismatch.eventCity}, but this crawl is for ${data.mismatch.crawlCity} — confirm or cancel next to the EB field.`,
        });
        return;
      }
      if ("linked" in data) {
        setToast(`Linked → ${data.eventName ?? "Eventbrite event"}`);
        appToast.show({
          kind: "success",
          message: `Linked → ${data.eventName ?? "Eventbrite event"}`,
        });
        setEditing(false);
      } else if ("unlinked" in data) {
        setToast("Unlinked");
        setEditing(false);
        setDraft("");
      }
    });
  }

  function unlink() {
    if (!confirm("Unlink this Eventbrite event from the crawl?")) return;
    setError(null);
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("eventbriteEventId", "");
    fd.set("campaignId", campaignId);
    startLink(async () => {
      const result = await linkEventbriteEvent(null, fd);
      if (result.ok) {
        setToast("Unlinked");
        setDraft("");
        setEditing(false);
      }
    });
  }

  function sync() {
    setError(null);
    const fd = new FormData();
    fd.set("eventId", eventId);
    startSync(async () => {
      const result = await syncEventbriteSales(null, fd);
      if (!result.ok) {
        showError(result.error ?? "Sync failed.");
        return;
      }
      const data = result.data;
      if (data && "notConfigured" in data) {
        showError("Eventbrite isn't configured.");
        return;
      }
      if (data && "sold" in data) {
        setToast(`Sales synced: ${data.sold}${data.capacity ? ` of ${data.capacity}` : ""}`);
      }
    });
  }

  function push(polish = false) {
    setError(null);
    const fd = new FormData();
    fd.set("eventId", eventId);
    if (polish) fd.set("polish", "true");
    startPush(async () => {
      const result = await pushEventbriteDescription(null, fd);
      if (!result.ok) {
        showError(result.error ?? "Push failed.");
        return;
      }
      const data = result.data;
      if (data && "notConfigured" in data) {
        showError("Eventbrite isn't configured.");
        return;
      }
      const polished = data && "polished" in data && data.polished;
      setToast(polished ? "Pushed with AI intro" : "Venue route pushed to Eventbrite");
    });
  }

  const busy = linking || syncing || pushing;

  return (
    <div className="relative">
      {!currentEbId && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:bg-orange-500/[0.08] hover:text-orange-700 dark:text-zinc-400 dark:hover:text-orange-300"
        >
          <Ticket className="h-3 w-3" />
          Link
        </button>
      )}

      {currentEbId && !editing && (
        <div className="flex items-center gap-1.5">
          <a
            href={currentEbUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
            title="Open in Eventbrite"
          >
            {currentEbId}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
          {!hideSync && (
            <button
              type="button"
              onClick={sync}
              disabled={busy}
              className="rounded p-1 text-zinc-400 transition-colors hover:bg-blue-500/[0.08] hover:text-blue-600"
              aria-label="Sync sales from Eventbrite"
              title="Pull sales from EB"
            >
              {syncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => push(false)}
            disabled={busy}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-emerald-500/[0.08] hover:text-emerald-600"
            aria-label="Push venue route to Eventbrite description"
            title="Push venue route to EB description"
          >
            {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          </button>
          {/* AI-polished push (Haiku ROI #7). Pushes the same venue
              route block but prepends a 1-2 sentence AI intro.
              ~$0.0007/click. */}
          <button
            type="button"
            onClick={() => push(true)}
            disabled={busy}
            className="rounded p-1 text-violet-400 transition-colors hover:bg-violet-500/[0.08] hover:text-violet-600 dark:text-violet-500"
            aria-label="Push venue route with AI-written intro"
            title="Push with an AI-written 1-2 sentence intro above the venue list"
          >
            <Sparkles className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            aria-label="Edit linkage"
            title="Edit Eventbrite ID"
          >
            <RefreshCw className="h-3 w-3 rotate-180 opacity-0 group-hover:opacity-100" />
            <span className="font-mono text-[10px] uppercase tracking-[0.08em]">edit</span>
          </button>
        </div>
      )}

      {editing && !confirmMismatch && (
        <div className="flex items-center gap-1.5">
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitLink();
              }
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(currentEbId ?? "");
                setError(null);
              }
            }}
            placeholder="EB event ID"
            className="h-7 w-32 font-mono text-[11px]"
            disabled={linking}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => submitLink()}
            disabled={linking || !draft.trim()}
          >
            {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </Button>
          {currentEbId && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={unlink}
              disabled={linking}
              title="Unlink"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Mismatch confirmation popover. right-0 (NOT left-0): this cell
          can sit at the right edge of a horizontally-scrolled table,
          where a left-anchored popover extends into the clipped overflow
          and is invisible. Anchoring right grows it INTO the visible
          region. */}
      {confirmMismatch && (
        <div className="absolute top-full right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2.5rem)] rounded-lg border border-rose-200 bg-rose-50/95 p-3 shadow-lg dark:border-rose-900/40 dark:bg-rose-950/80">
          <div className="mb-2 flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="flex-1">
              <p className="font-medium text-rose-900 text-xs dark:text-rose-100">City mismatch</p>
              <p className="mt-1 text-[11px] text-rose-800 leading-relaxed dark:text-rose-200">
                The Eventbrite event <strong className="italic">{confirmMismatch.ebName}</strong> is
                in <strong>{confirmMismatch.eventCity}</strong>, but this crawl is for{" "}
                <strong>{confirmMismatch.crawlCity}</strong>. Link anyway?
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirmMismatch(null)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => submitLink(true)} disabled={linking}>
              {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : "Link anyway"}
            </Button>
          </div>
        </div>
      )}

      {/* In-flow (NOT absolute): absolute positioning clipped these
          under the next table row, so EB errors were unreadable
          (operator report 2026-06-11). In-flow grows the row instead. */}
      {error && (
        <p
          role="alert"
          title={error}
          // Compact on purpose: a wide block widens this (last) table
          // column and pushes the text into the horizontal-scroll
          // overflow. The toast carries the full message; this is the
          // in-place marker.
          className="mt-1 max-w-[11rem] whitespace-normal break-words rounded-md bg-rose-50 px-2 py-1 text-[10px] text-rose-700 leading-snug dark:bg-rose-950/30 dark:text-rose-300"
        >
          {error}
        </p>
      )}
      {toast && !error && (
        <p className="mt-1 max-w-[18rem] whitespace-normal break-words text-[10px] text-emerald-700 leading-snug dark:text-emerald-400">
          {toast}
        </p>
      )}
      {ticketsSold > 0 && currentEbId && !editing && (
        <p className="-bottom-4 absolute left-0 font-mono text-[10px] text-zinc-500 tabular-nums">
          {ticketsSold} sold
        </p>
      )}
    </div>
  );
}
