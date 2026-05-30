"use client";

/**
 * ThreadMoreMenu — the Gmail-style three-dot menu in the thread header.
 *
 * Surfaces less-frequently-used actions so the main action row stays
 * uncluttered:
 *
 *   - Mark unread       (counterpart to the auto-mark-read on open)
 *   - Open in Gmail     (deep link via the gmail_thread_id)
 *   - Print             (window.print)
 *   - Move to interested / declined (engine state transitions; the
 *     primary Interested/Declined buttons stay in ThreadActions, but
 *     mirroring them here keeps the menu Gmail-shaped)
 *   - Move to Trash     (mirror of the rose Trash button)
 *
 * Future additions: Add label, Move to (other engine states), Block
 * sender, Create task, Link to venue, Do not contact, Mark as spam.
 * Each lands as a follow-up commit since several need new server
 * actions or refinements to existing ones.
 */

import {
  Ban,
  ExternalLink,
  Loader2,
  Mail,
  MoreVertical,
  Printer,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { blockThreadSender, markThreadUnread, reportThreadSpam, setThreadTrash } from "../_actions";

interface Props {
  threadId: string;
  /** Gmail's thread id for the deep link. */
  gmailThreadId: string;
}

export function ThreadMoreMenu({ threadId, gmailThreadId }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTx] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleMarkUnread() {
    setOpen(false);
    startTx(async () => {
      await markThreadUnread(threadId);
      router.refresh();
    });
  }

  function handleOpenInGmail() {
    setOpen(false);
    // Gmail's web URL pattern. Works in the operator's default Gmail
    // account; if they have multiple Google accounts, Gmail will
    // prompt to pick. /u/0/ is the first account; we could read from
    // the connected_account's owner email but that requires URL
    // shaping that isn't necessarily stable across Gmail versions.
    const url = `https://mail.google.com/mail/u/0/#all/${gmailThreadId}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handlePrint() {
    setOpen(false);
    // Browser-native print. The current thread is already rendered
    // in the right pane so window.print captures the visible thread.
    window.print();
  }

  function handleTrash() {
    setOpen(false);
    if (!confirm("Move this thread to Trash?")) return;
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      fd.set("trashed", "true");
      const res = await setThreadTrash(null, fd);
      if (res.ok) router.push("/inbox");
    });
  }

  function handleReportSpam() {
    setOpen(false);
    if (
      !confirm(
        "Report this thread as spam? It will be marked as spam in Gmail (which trains the spam filter against this sender) and removed from your inbox here.",
      )
    )
      return;
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      const res = await reportThreadSpam(null, fd);
      if (res.ok) {
        if (res.data && !res.data.gmailReported) {
          alert(
            "Moved to spam locally, but the Gmail spam label couldn't be applied (token may be expired). Mark as spam in Gmail's web UI to train the filter.",
          );
        }
        router.push("/inbox");
      } else {
        alert(res.error);
      }
    });
  }

  function handleBlockSender() {
    setOpen(false);
    if (
      !confirm(
        "Block the latest inbound sender on this thread? Their address will be added to your team's suppression list so we never send to them again.",
      )
    )
      return;
    startTx(async () => {
      const fd = new FormData();
      fd.set("threadId", threadId);
      const res = await blockThreadSender(null, fd);
      if (res.ok) {
        alert(`Blocked ${res.data?.blocked}. They've been added to the suppression list.`);
      } else {
        alert(res.error);
      }
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        title="More actions"
        aria-label="More actions"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-900"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <MoreVertical className="h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <div
          // biome-ignore lint/a11y/useSemanticElements: anchored menu pattern
          role="menu"
          tabIndex={-1}
          className="absolute top-full right-0 z-30 mt-1 w-48 rounded-md border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-800 dark:bg-zinc-950"
        >
          <MenuItem
            icon={<Mail className="h-3 w-3" />}
            label="Mark as unread"
            onClick={handleMarkUnread}
          />
          <MenuItem
            icon={<ExternalLink className="h-3 w-3" />}
            label="Open in Gmail"
            onClick={handleOpenInGmail}
          />
          <MenuItem icon={<Printer className="h-3 w-3" />} label="Print" onClick={handlePrint} />
          <div className="my-1 border-zinc-200/70 border-t dark:border-zinc-800" />
          <MenuItem
            icon={<ShieldAlert className="h-3 w-3" />}
            label="Report as spam"
            onClick={handleReportSpam}
            tone="rose"
          />
          <MenuItem
            icon={<Ban className="h-3 w-3" />}
            label="Block sender"
            onClick={handleBlockSender}
            tone="rose"
          />
          <MenuItem
            icon={<Trash2 className="h-3 w-3" />}
            label="Move to Trash"
            onClick={handleTrash}
            tone="rose"
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
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "rose";
}) {
  const toneClass =
    tone === "rose"
      ? "text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
      : "hover:bg-zinc-100 dark:hover:bg-zinc-900";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${toneClass}`}
    >
      <span className="shrink-0 text-zinc-500">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
