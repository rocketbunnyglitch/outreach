"use client";

/**
 * FindEmailButton — opinionated "go find this venue's email" helper.
 *
 * When tapped:
 *   1. Opens up to 3 browser tabs at once:
 *      • venue website (if known)
 *      • Google search for "<venue name> <city> contact email"
 *      • Instagram search / direct profile if instagramHandle is known
 *   2. On the original tab, a floating panel slides in with a paste
 *      field + an "I found it" save button
 *   3. Operator pastes the email they found, hits Save
 *   4. Server action saves it to venues.email + logs provenance to
 *      outreach_log + fires ZeroBounce validation in the background
 *
 * Why we don't try to scrape automatically:
 *   - Bar/restaurant websites rarely list a contact email in machine-
 *     readable form
 *   - Scraping → fragile + legal grey area + still wrong half the time
 *   - 30 seconds of operator-driven search is faster and more accurate
 *     than fighting a scraper
 *
 * UX detail: we don't actually FORCE the popup to appear before the
 * operator finishes searching — they can hit "Skip" too. The button
 * just opens the tabs and shows the panel.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Check, ExternalLink, Loader2, MailSearch, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setVenueEmailFromSearch } from "../../venues/_actions";

interface Props {
  venueId: string;
  venueName: string;
  venueWebsite: string | null;
  venueInstagramHandle: string | null;
  venueCity: string | null;
  /** If the venue already has an email, we still let the operator
      override it — but the panel preloads the existing value. */
  existingEmail: string | null;
  /** Optional brand context so the outreach_log provenance row picks
      up the right outreachBrandId. */
  outreachBrandId: string | null;
  /** Optional cold-outreach entry id — when set, the action revalidates
      that campaign's page. */
  cityCampaignId?: string;
  /** Tone: 'icon' for tight tables, 'button' for venue detail pages. */
  variant?: "icon" | "button";
}

export function FindEmailButton({
  venueId,
  venueName,
  venueWebsite,
  venueInstagramHandle,
  venueCity,
  existingEmail,
  outreachBrandId,
  variant = "icon",
}: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(existingEmail ?? "");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTx] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Focus the paste input the first time the panel opens
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Esc to dismiss
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function openSearchTabs() {
    setOpen(true);
    setError(null);
    setSaved(false);

    // Build the 3 tabs.
    const tabs: string[] = [];
    if (venueWebsite) tabs.push(normalizeWebsite(venueWebsite));
    const cityPart = venueCity ? ` ${venueCity}` : "";
    const googleQuery = encodeURIComponent(`"${venueName}"${cityPart} contact email`);
    tabs.push(`https://www.google.com/search?q=${googleQuery}`);
    if (venueInstagramHandle) {
      const handle = venueInstagramHandle.replace(/^@/, "").trim();
      if (handle) tabs.push(`https://www.instagram.com/${handle}/`);
    } else {
      // No IG handle on file — fall back to an IG search via google
      tabs.push(
        `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com "${venueName}"${cityPart}`)}`,
      );
    }

    // Open them. Modern browsers will allow multiple window.open calls
    // because they're inside a user gesture (the button click).
    for (const url of tabs) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function save() {
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Paste an email first.");
      inputRef.current?.focus();
      return;
    }
    const fd = new FormData();
    fd.set("venueId", venueId);
    fd.set("email", trimmed);
    if (outreachBrandId) fd.set("outreachBrandId", outreachBrandId);
    if (source.trim()) fd.set("source", source.trim());
    startTx(async () => {
      const result = await setVenueEmailFromSearch(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save that email.");
        return;
      }
      setSaved(true);
      // Close after a short confirmation so the operator sees it worked
      setTimeout(() => {
        setOpen(false);
        setSaved(false);
        router.refresh();
      }, 800);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openSearchTabs}
        title={existingEmail ? `Find a better email (current: ${existingEmail})` : "Find email"}
        className={
          variant === "icon"
            ? "inline-flex items-center justify-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-amber-500/[0.08] hover:text-amber-600 dark:hover:text-amber-400"
            : "inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        }
        aria-label="Find email"
      >
        <MailSearch className={variant === "icon" ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
        {variant === "button" && <span>Find email</span>}
      </button>

      {open && (
        <div
          className={cn(
            "fixed right-4 bottom-4 z-50 w-80 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl",
            "dark:border-zinc-800 dark:bg-zinc-900",
            "animate-[fade-in_200ms_ease-out]",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="flex items-center gap-1.5 font-semibold text-sm">
                <MailSearch className="h-3.5 w-3.5 text-amber-500" />
                Find email
              </h4>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">{venueName}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <ul className="mt-3 flex flex-col gap-0.5 text-[10px]">
            <li className="flex items-center gap-1 font-mono text-zinc-500 uppercase tracking-[0.1em]">
              opened in new tabs
            </li>
            {venueWebsite && (
              <li className="truncate text-zinc-600 dark:text-zinc-400">
                <ExternalLink className="mr-1 inline h-2.5 w-2.5" />
                {venueWebsite}
              </li>
            )}
            <li className="truncate text-zinc-600 dark:text-zinc-400">
              <ExternalLink className="mr-1 inline h-2.5 w-2.5" />
              Google: "{venueName}" contact email
            </li>
            <li className="truncate text-zinc-600 dark:text-zinc-400">
              <ExternalLink className="mr-1 inline h-2.5 w-2.5" />
              {venueInstagramHandle
                ? `Instagram: @${venueInstagramHandle.replace(/^@/, "")}`
                : "Instagram search"}
            </li>
          </ul>

          <label className="mt-3 block">
            <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
              Paste the email you found
            </span>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="hello@venue.com"
              disabled={pending || saved}
              className={cn(
                "mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                "dark:border-zinc-700 dark:bg-zinc-900",
              )}
            />
          </label>

          <label className="mt-2 block">
            <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-[0.12em]">
              Source (optional)
            </span>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="IG bio · /contact page · etc"
              disabled={pending || saved}
              className={cn(
                "mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                "dark:border-zinc-700 dark:bg-zinc-900",
              )}
            />
          </label>

          {error && (
            <p
              role="alert"
              className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
            >
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Skip — couldn't find one
            </button>
            <Button type="button" onClick={save} disabled={pending || !email.trim() || saved}>
              {saved ? (
                <Check className="h-3 w-3" />
              ) : pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {saved ? "Saved" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function normalizeWebsite(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}
