"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { EnrichVenueResult } from "@/lib/enrichment-orchestrator";
import {
  Check,
  Facebook,
  History,
  Instagram,
  Loader2,
  Mail,
  RefreshCw,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setVenueEmailFromSearch } from "../_actions";
import {
  type EnrichmentHistoryRow,
  getEnrichmentHistory,
  triggerVenueEnrichment,
} from "../_enrichment-actions";

export interface ScrapedEmailView {
  email: string;
  role_hint: string;
  source_page: string;
  confidence: number;
}

export interface VenueEnrichmentCardProps {
  venueId: string;
  hasContactEmail: boolean;
  hasWebsite: boolean;
  status: string | null;
  lastAttemptLabel: string | null;
  scrapedEmails: ScrapedEmailView[];
  scrapedInstagram: string | null;
  scrapedFacebook: string | null;
  hasAttempted: boolean;
}

/** Reserved palette: emerald=done, rose=destructive, amber=warning,
 *  blue=info, violet=AI, zinc=neutral. */
function statusStyle(status: string | null): { label: string; cls: string } {
  switch (status) {
    case "tier1_success":
      return {
        label: "Found (Tier 1)",
        cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
      };
    case "tier2_success":
      return {
        label: "Found (Tier 2 AI)",
        cls: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
      };
    case "tier1_partial":
      return {
        label: "Partial",
        cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
      };
    case "tier1_failed_no_emails":
    case "tier2_failed":
      return {
        label: "No emails found",
        cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
      };
    case "unreachable":
      return {
        label: "Unreachable",
        cls: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
      };
    case "no_website":
      return {
        label: "No website",
        cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
      };
    case "manual_override":
      return {
        label: "Manual",
        cls: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
      };
    default:
      return {
        label: "Never run",
        cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
      };
  }
}

const SKIP_MESSAGE: Record<string, string> = {
  has_email: "This venue already has a contact email — nothing to scrape.",
  no_website: "No website on file, so there's nothing to scrape. Add a website first.",
  already_attempted: "Already attempted before. Use “Re-try (force)” to scrape again.",
  not_found: "Venue not found.",
};

function summarize(r: EnrichVenueResult): { kind: "success" | "info"; message: string } {
  const found = r.emails_found ?? 0;
  if (found > 0) {
    const tier = r.tier_used === 2 ? " (via AI fallback)" : "";
    const socials = r.has_socials ? " + socials" : "";
    return {
      kind: "success",
      message: `Found ${found} email${found === 1 ? "" : "s"}${socials}${tier}.`,
    };
  }
  if (r.has_socials)
    return { kind: "info", message: "No emails found, but captured a social link." };
  return { kind: "info", message: `No contacts found (${r.status ?? "failed"}).` };
}

export function VenueEnrichmentCard(props: VenueEnrichmentCardProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();
  const [manualEmail, setManualEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<EnrichmentHistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const style = statusStyle(props.status);

  /** Set the venue's contact email from a pasted/scraped address. Reuses the
   *  existing setVenueEmailFromSearch action (updates venues.email, logs it,
   *  triggers ZeroBounce validation), then refreshes so the Details tab + this
   *  card reflect it. */
  function saveEmail(email: string, source: string) {
    const e = email.trim();
    if (!e || saving) return;
    startSaving(async () => {
      const fd = new FormData();
      fd.set("venueId", props.venueId);
      fd.set("email", e);
      fd.set("source", source);
      const res = await setVenueEmailFromSearch(null, fd);
      if (res.ok) {
        toast.show({ kind: "success", message: `Saved ${res.data.email} as the contact email.` });
        setManualEmail("");
        router.refresh();
      } else {
        toast.show({
          kind: "error",
          message: res.error ?? "Couldn't save the email.",
          tag: "venue.email",
        });
      }
    });
  }

  function run(forceRetry: boolean) {
    setConfirmOpen(false);
    startTransition(async () => {
      try {
        const result = await triggerVenueEnrichment(props.venueId, forceRetry);
        if (result.skipped) {
          toast.show({
            kind: "info",
            message: SKIP_MESSAGE[result.skipped_reason ?? ""] ?? "Skipped this venue.",
            tag: "enrichment.skip",
          });
          return;
        }
        const summary = summarize(result);
        toast.show({ kind: summary.kind, message: summary.message, tag: "enrichment.done" });
        router.refresh();
      } catch (err) {
        toast.show({
          kind: "error",
          message: "Enrichment failed. See server logs.",
          tag: "enrichment.error",
        });
        console.error("[enrichment] trigger failed", err);
      }
    });
  }

  function openHistory() {
    setHistoryOpen(true);
    if (history === null && !historyLoading) {
      setHistoryLoading(true);
      getEnrichmentHistory(props.venueId)
        .then(setHistory)
        .catch((err) => {
          console.error("[enrichment] history load failed", err);
          toast.show({
            kind: "error",
            message: "Couldn't load history.",
            tag: "enrichment.history",
          });
        })
        .finally(() => setHistoryLoading(false));
    }
  }

  return (
    <div className="card-surface flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm tracking-tight">Contact enrichment</h3>
        <span className={`rounded-full px-2 py-0.5 font-medium text-xs ${style.cls}`}>
          {style.label}
        </span>
      </div>

      {props.lastAttemptLabel && (
        <p className="text-xs text-zinc-500">Last attempted {props.lastAttemptLabel}</p>
      )}

      {/* Scraped contacts */}
      {props.scrapedEmails.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {props.scrapedEmails.map((e) => (
            <li key={e.email} className="flex items-center gap-2 text-sm">
              <Mail className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <a
                href={`mailto:${e.email}`}
                className="truncate text-blue-600 hover:underline dark:text-blue-400"
              >
                {e.email}
              </a>
              <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {e.role_hint} · {e.confidence}%
              </span>
              <button
                type="button"
                onClick={() => saveEmail(e.email, `scrape:${e.role_hint}`)}
                disabled={saving}
                className="ml-auto shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                title="Set as this venue's contact email"
              >
                Use
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-400">No scraped emails yet.</p>
      )}

      {/* Manual email entry — paste an address you found (e.g. on Facebook) and
          Save: sets it as the venue's contact email + ZeroBounce-checks it. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={manualEmail}
            onChange={(e) => setManualEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveEmail(manualEmail, "manual");
              }
            }}
            placeholder="Paste a contact email…"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          <Button
            type="button"
            onClick={() => saveEmail(manualEmail, "manual")}
            disabled={saving || !manualEmail.trim()}
            className="shrink-0"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>
        <p className="text-[11px] text-zinc-400">
          Sets the venue's contact email (Details tab) and runs a ZeroBounce check.
        </p>
      </div>

      {(props.scrapedInstagram || props.scrapedFacebook) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {props.scrapedInstagram && (
            <a
              href={props.scrapedInstagram}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
            >
              <Instagram className="h-3.5 w-3.5" /> Instagram
            </a>
          )}
          {props.scrapedFacebook && (
            <a
              href={props.scrapedFacebook}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
            >
              <Facebook className="h-3.5 w-3.5" /> Facebook
            </a>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <Button onClick={() => run(false)} disabled={pending} className="w-full justify-center">
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Scraping… (10–30s)
            </>
          ) : (
            <>
              <Search className="h-4 w-4" /> Pull contact info
            </>
          )}
        </Button>

        <div className="flex gap-2">
          {props.hasAttempted && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              disabled={pending}
              className="flex-1 justify-center text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Re-try (force)
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={openHistory}
            className="flex-1 justify-center text-xs"
          >
            <History className="h-3.5 w-3.5" /> History
          </Button>
        </div>
      </div>

      {!props.hasWebsite && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          No website on file — add one so the scraper has something to read.
        </p>
      )}

      {/* Force-retry confirm modal */}
      {confirmOpen && (
        <Overlay onClose={() => setConfirmOpen(false)}>
          <h4 className="font-semibold text-sm">Re-scrape this venue?</h4>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            This will re-scrape the website and cost ~$0.004 if the AI fallback (Tier 2) is needed.
            Continue?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => run(true)}>
              Re-scrape
            </Button>
          </div>
        </Overlay>
      )}

      {/* History modal */}
      {historyOpen && (
        <Overlay onClose={() => setHistoryOpen(false)}>
          <h4 className="font-semibold text-sm">Enrichment history</h4>
          {historyLoading && (
            <p className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
          {history && history.length === 0 && (
            <p className="mt-3 text-sm text-zinc-500">No attempts recorded yet.</p>
          )}
          {history && history.length > 0 && (
            <ul className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto">
              {history.map((h) => {
                const hs = statusStyle(h.status);
                return (
                  <li
                    key={h.id}
                    className="rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full px-1.5 py-0.5 font-medium ${hs.cls}`}>
                        {hs.label}
                      </span>
                      <span className="text-zinc-400">{h.attemptedAtLabel}</span>
                    </div>
                    <div className="mt-1 text-zinc-500">
                      {h.emailsFound} email{h.emailsFound === 1 ? "" : "s"}
                      {h.instagramFound ? " · IG" : ""}
                      {h.facebookFound ? " · FB" : ""}
                      {h.tierUsed ? ` · Tier ${h.tierUsed}` : ""}
                      {` · ${h.triggerSource}`}
                      {Number(h.costEstimateUsd) > 0
                        ? ` · $${Number(h.costEstimateUsd).toFixed(4)}`
                        : ""}
                    </div>
                    {h.errorMessage && <div className="mt-1 text-rose-500">{h.errorMessage}</div>}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="ghost" onClick={() => setHistoryOpen(false)}>
              Close
            </Button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

/** Minimal modal overlay — the codebase has no shared Dialog primitive, so
 *  matches the bespoke pattern used by handoff-modal.tsx. */
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
