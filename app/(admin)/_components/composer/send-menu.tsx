"use client";

/**
 * SendMenu — Gmail-style split button next to the Send action.
 *
 * Main button fires sendNow. Chevron opens a popover with:
 *   • Send now (same as the main button)
 *   • Schedule send …  (opens a datetime picker; the composer stores
 *                       scheduledFor; the /api/cron/scheduled-sends
 *                       cron dispatches due drafts every 5 minutes)
 *   • Send test to myself
 *   • Save as draft (forces immediate upsertDraft + closes the
 *                    composer; row stays in email_drafts)
 *   • Preview final email (modal with the rendered final shape)
 *
 * Discard is the trash icon in the footer (a destructive action
 * deserves to stand on its own + carry confirm).
 */

import { cn } from "@/lib/cn";
import { Calendar, ChevronDown, Eye, FileText, Inbox, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  disabled?: boolean;
  pending?: boolean;
  scheduledFor: string | null;
  onSendNow: () => void;
  onSchedule: (iso: string | null) => void;
  onSendTest: () => void;
  onSaveAsDraft: () => void;
  onPreview: () => void;
}

export function SendMenu({
  disabled,
  pending,
  scheduledFor,
  onSendNow,
  onSchedule,
  onSendTest,
  onSaveAsDraft,
  onPreview,
}: Props) {
  const [open, setOpen] = useState(false);
  const [showDateInput, setShowDateInput] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowDateInput(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const primaryLabel = scheduledFor
    ? `Send ${new Date(scheduledFor).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
    : "Send";

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={onSendNow}
        disabled={disabled || pending}
        className="inline-flex items-center gap-1.5 rounded-l-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <Send className="h-3 w-3" />
        {pending ? "Sending…" : primaryLabel}
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || pending}
        aria-label="Send options"
        className="inline-flex items-center rounded-r-md border border-l border-l-white/20 bg-zinc-900 px-1.5 py-1.5 text-white hover:bg-zinc-800 disabled:opacity-50 dark:border-l-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-56 rounded-md border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
          <MenuItem
            icon={<Send className="h-3 w-3" />}
            label="Send now"
            onClick={() => {
              setOpen(false);
              onSendNow();
            }}
          />
          {showDateInput ? (
            <div className="border-zinc-100 border-t border-b px-3 py-2 dark:border-zinc-800">
              <label className="block text-[10px] text-zinc-500" htmlFor="composer-schedule-input">
                Schedule for
              </label>
              <input
                id="composer-schedule-input"
                type="datetime-local"
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                onChange={(e) => {
                  if (!e.target.value) return;
                  // datetime-local is local-time; convert to ISO.
                  const local = new Date(e.target.value);
                  onSchedule(local.toISOString());
                  setOpen(false);
                  setShowDateInput(false);
                }}
              />
              <p className="mt-1 font-mono text-[9px] text-zinc-500">
                Scheduled drafts fire on the next cron tick (every 5 minutes). Owner's daily send
                cap still applies at dispatch time.
              </p>
            </div>
          ) : (
            <MenuItem
              icon={<Calendar className="h-3 w-3" />}
              label="Schedule send…"
              onClick={() => setShowDateInput(true)}
            />
          )}
          {scheduledFor && (
            <MenuItem
              icon={<Calendar className="h-3 w-3" />}
              label="Clear schedule"
              onClick={() => {
                onSchedule(null);
                setOpen(false);
              }}
            />
          )}
          <div className="my-0.5 border-zinc-100 border-t dark:border-zinc-800" />
          <MenuItem
            icon={<Inbox className="h-3 w-3" />}
            label="Send test to myself"
            onClick={() => {
              setOpen(false);
              onSendTest();
            }}
          />
          <MenuItem
            icon={<FileText className="h-3 w-3" />}
            label="Save as draft + close"
            onClick={() => {
              setOpen(false);
              onSaveAsDraft();
            }}
          />
          <MenuItem
            icon={<Eye className="h-3 w-3" />}
            label="Preview final email"
            onClick={() => {
              setOpen(false);
              onPreview();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
        disabled ? "cursor-not-allowed text-zinc-400" : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
