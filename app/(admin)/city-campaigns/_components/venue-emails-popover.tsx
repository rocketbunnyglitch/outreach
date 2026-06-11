"use client";

/**
 * Multi-email editor for one venue (operator request 2026-06-11: "can
 * manually input multiple emails for one venue... and the email will
 * email them all").
 *
 * Trigger: a small mail-plus icon next to the email cell in the
 * cold/warm outreach table; shows a "+N" badge when the venue has
 * alternate addresses on file. The popover lists every address as its
 * own input field — first one is the primary (venues.email), the rest
 * land in venues.alternate_emails. Compose paths join primary +
 * alternates into the To line, so everything saved here gets emailed.
 */

import { cn } from "@/lib/cn";
import { Loader2, MailPlus, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { commitVenueEmails } from "../_cold-outreach-actions";

export function VenueEmailsButton({
  venueId,
  cityCampaignId,
  email,
  alternateEmails,
}: {
  venueId: string;
  cityCampaignId: string;
  email: string | null;
  alternateEmails: string[];
}) {
  const [open, setOpen] = useState(false);
  const altCount = alternateEmails.length;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label="Edit all emails for this venue"
        title={
          altCount > 0
            ? `${altCount + (email ? 1 : 0)} emails on file — sends go to all of them`
            : "Add more emails — sends go to every address listed"
        }
      >
        <MailPlus className="h-3.5 w-3.5" />
        {altCount > 0 && (
          <span className="-top-0.5 -right-0.5 absolute rounded-full bg-blue-500/15 px-1 font-mono text-[8px] text-blue-700 leading-3 ring-1 ring-blue-500/30 dark:text-blue-300">
            +{altCount}
          </span>
        )}
      </button>
      {open && (
        <EmailsPopover
          venueId={venueId}
          cityCampaignId={cityCampaignId}
          initialEmails={[email, ...alternateEmails].filter((e): e is string => Boolean(e?.trim()))}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function EmailsPopover({
  venueId,
  cityCampaignId,
  initialEmails,
  onClose,
}: {
  venueId: string;
  cityCampaignId: string;
  initialEmails: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const idCounter = useRef(Math.max(initialEmails.length, 1));
  const [fields, setFields] = useState<Array<{ id: string; value: string }>>(() =>
    (initialEmails.length > 0 ? initialEmails : [""]).map((value, i) => ({
      id: `e-${i}`,
      value,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
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

  function addField() {
    idCounter.current += 1;
    setFields((prev) => [...prev, { id: `e-${idCounter.current}`, value: "" }]);
  }

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("venueId", venueId);
    fd.set("cityCampaignId", cityCampaignId);
    fd.set("emails", JSON.stringify(fields.map((f) => f.value.trim()).filter(Boolean)));
    startSave(async () => {
      const result = await commitVenueEmails(null, fd);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save emails.");
        return;
      }
      // Pull the fresh primary + alternates into the table row.
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      ref={containerRef}
      className="absolute right-0 z-50 mt-1 w-72 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
    >
      <header className="flex items-center justify-between border-zinc-200/60 border-b px-3 py-2 dark:border-zinc-800/40">
        <div>
          <p className="font-semibold text-xs tracking-tight">Venue emails</p>
          <p className="font-mono text-[10px] text-zinc-500">first = primary · sends go to all</p>
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
      <div className="flex flex-col gap-2 p-3">
        {fields.map((field, i) => (
          <div key={field.id} className="flex items-center gap-1.5">
            <input
              ref={i === 0 ? firstInputRef : undefined}
              type="email"
              value={field.value}
              onChange={(e) => {
                setError(null);
                setFields((prev) =>
                  prev.map((f) => (f.id === field.id ? { ...f, value: e.target.value } : f)),
                );
              }}
              placeholder={i === 0 ? "events@venue.com" : "another@venue.com"}
              aria-label={i === 0 ? "Primary email" : `Email ${i + 1}`}
              className={cn(
                "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-xs transition-colors",
                "placeholder:text-zinc-400/70 focus:border-zinc-400 focus:outline-none",
                "dark:border-zinc-800 dark:bg-zinc-950",
              )}
            />
            {fields.length > 1 && (
              <button
                type="button"
                onClick={() => setFields((prev) => prev.filter((f) => f.id !== field.id))}
                className="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600 dark:hover:text-rose-400"
                aria-label="Remove this email"
                title="Remove this email"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {fields.length < 10 && (
          <button
            type="button"
            onClick={addField}
            className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <Plus className="h-3 w-3" />
            Add email
          </button>
        )}
        {error && (
          <p className="rounded-md bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-zinc-900 px-2.5 py-1 font-mono text-[10px] text-white uppercase tracking-[0.08em] transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
