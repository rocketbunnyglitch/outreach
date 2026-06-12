"use client";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  AlertCircle,
  Bell,
  Check,
  CheckCheck,
  Eye,
  Loader2,
  Mail,
  MessageSquare,
  Sparkles,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  type NotificationListing,
  type NotificationRow,
  acknowledgeNotification,
  listMyNotifications,
  markNotificationsRead,
} from "../_actions/notifications";

/**
 * Notification bell in the top nav.
 *
 * Initial state comes from the server on mount; clicking opens a
 * dropdown with the recent list + 'mark all read'. Polls every 60s
 * while the page is in focus to surface new items without requiring
 * a full reload.
 *
 * Bell badge shows the unread count (capped at 99+). When unread = 0,
 * the bell is a calm zinc-500; when unread > 0, the bell shifts to
 * the blue tone of other 'attention needed' affordances in the app.
 */

const POLL_INTERVAL_MS = 60_000;

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  reply: MessageSquare,
  seen: Eye,
  mention: User,
  email_invalid: AlertCircle,
  ai_draft_failed: Sparkles,
  edit_conflict: AlertCircle,
  admin_message: Mail,
};

const KIND_TONES: Record<string, string> = {
  reply: "text-emerald-600 dark:text-emerald-400",
  seen: "text-violet-600 dark:text-violet-400",
  mention: "text-blue-600 dark:text-blue-400",
  email_invalid: "text-rose-600 dark:text-rose-400",
  ai_draft_failed: "text-rose-600 dark:text-rose-400",
  edit_conflict: "text-rose-600 dark:text-rose-400",
  admin_message: "text-zinc-600 dark:text-zinc-400",
};

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<NotificationListing>({
    items: [],
    unreadCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [pending, startTx] = useTransition();
  const toast = useToast();
  const popoverRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await listMyNotifications(25);
      setListing(data);
    } catch {
      // Quiet — bell stays at last-known state
    } finally {
      setLoading(false);
    }
  }

  // Initial load + polling
  useEffect(() => {
    refresh();
    let interval: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      if (interval) return;
      interval = setInterval(refresh, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }

    startPolling();

    function onVisibility() {
      if (document.visibilityState === "visible") {
        // Tab regained focus — refresh immediately + resume polling
        refresh();
        startPolling();
      } else {
        // Backgrounded — pause polling to save server load
        stopPolling();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Click-outside close
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const fd = new FormData();
    fd.set("ids", ids.join(","));
    startTx(async () => {
      const result = await markNotificationsRead(null, fd);
      if (!result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't mark read.",
          code: (result as { code?: string }).code,
        });
        return;
      }
      // Optimistic update — drop unread badge on these rows locally
      setListing((prev) => ({
        items: prev.items.map((n) =>
          ids.includes(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n,
        ),
        unreadCount: Math.max(0, prev.unreadCount - ids.length),
      }));
    });
  }

  function markAllRead() {
    const fd = new FormData();
    fd.set("all", "true");
    startTx(async () => {
      const result = await markNotificationsRead(null, fd);
      if (!result.ok) {
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't mark all read.",
          code: (result as { code?: string }).code,
        });
        return;
      }
      setListing((prev) => ({
        items: prev.items.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
        unreadCount: 0,
      }));
      toast.show({ kind: "success", message: `Marked ${result.data?.marked ?? 0} read` });
    });
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative rounded-md p-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800",
          listing.unreadCount > 0 ? "text-blue-600 dark:text-blue-400" : "text-zinc-500",
        )}
        title={listing.unreadCount > 0 ? `${listing.unreadCount} unread` : "Notifications"}
        aria-label={
          listing.unreadCount > 0 ? `${listing.unreadCount} unread notifications` : "Notifications"
        }
      >
        <Bell className="h-4 w-4" />
        {listing.unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-blue-600 px-1 font-medium font-mono text-[9px] text-white tabular-nums">
            {listing.unreadCount > 99 ? "99+" : listing.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <header className="flex items-center justify-between border-zinc-200/60 border-b bg-zinc-50/40 px-3 py-2 dark:border-zinc-800/40 dark:bg-zinc-900/40">
            <div className="flex items-center gap-1.5">
              <Bell className="h-3 w-3 text-zinc-500" />
              <h3 className="font-mono text-[10px] text-zinc-700 uppercase tracking-[0.08em] dark:text-zinc-300">
                Notifications
              </h3>
              {listing.unreadCount > 0 && (
                <span className="font-mono text-[10px] text-blue-600 tabular-nums dark:text-blue-400">
                  · {listing.unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {listing.unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={pending}
                  className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="Mark all read"
                  aria-label="Mark all read"
                >
                  <CheckCheck className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                aria-label="Close"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </header>

          <div className="max-h-96 overflow-y-auto">
            {loading && listing.items.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
                  Loading…
                </p>
              </div>
            )}

            {!loading && listing.items.length === 0 && (
              <div className="px-3 py-12 text-center">
                <Bell className="mx-auto mb-2 h-6 w-6 text-zinc-300" />
                <p className="text-sm text-zinc-500">You're all caught up.</p>
                <p className="mt-1 font-mono text-[9px] text-zinc-400 uppercase tracking-[0.08em]">
                  Replies + alerts will land here
                </p>
              </div>
            )}

            {listing.items.length > 0 && (
              <ul className="divide-y divide-zinc-200/40 dark:divide-zinc-800/30">
                {listing.items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    item={n}
                    onMarkRead={() => markRead([n.id])}
                    onClose={() => setOpen(false)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  item,
  onMarkRead,
  onClose,
}: {
  item: NotificationRow;
  onMarkRead: () => void;
  onClose: () => void;
}) {
  const Icon = KIND_ICONS[item.kind] ?? Bell;
  const tone = KIND_TONES[item.kind] ?? "text-zinc-500";
  const isUnread = !item.readAt;
  // Phase 4.6: escalatable alerts (cancellations) get an Acknowledge pill.
  const [acked, setAcked] = useState(false);
  const [ackPending, startAck] = useTransition();
  const showAck = !!item.escalateAfter && !item.acknowledgedAt && !acked;
  function ack() {
    startAck(async () => {
      const res = await acknowledgeNotification(item.id);
      if (res.ok) setAcked(true);
    });
  }

  const content = (
    <div className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
      {/* Unread dot indicator */}
      <div className="mt-1.5 flex w-1.5 shrink-0 justify-center">
        {isUnread ? (
          <span className="h-1.5 w-1.5 rounded-full bg-blue-600" aria-label="Unread" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-transparent" />
        )}
      </div>
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone)} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm",
            isUnread
              ? "font-medium text-zinc-900 dark:text-zinc-100"
              : "text-zinc-600 dark:text-zinc-400",
          )}
        >
          {item.title}
        </p>
        {item.body && (
          <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">{item.body}</p>
        )}
        <p className="mt-0.5 font-mono text-[9px] text-zinc-400 uppercase tracking-[0.08em]">
          {formatRelativeTime(item.createdAt)}
        </p>
        {showAck ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ack();
            }}
            disabled={ackPending}
            className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[9px] text-amber-800 uppercase tracking-[0.08em] hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          >
            Acknowledge
          </button>
        ) : item.acknowledgedAt || acked ? (
          <p className="mt-0.5 font-mono text-[9px] text-emerald-600 uppercase tracking-[0.08em]">
            acknowledged
          </p>
        ) : null}
      </div>
      {isUnread && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMarkRead();
          }}
          className="rounded-md p-1 text-zinc-300 opacity-0 transition-all hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100 pointer-coarse:opacity-100 dark:hover:bg-zinc-800"
          aria-label="Mark read"
          title="Mark read"
        >
          <Check className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  if (item.linkPath) {
    return (
      <li className="group">
        <Link
          href={item.linkPath}
          onClick={() => {
            if (isUnread) onMarkRead();
            onClose();
          }}
          className="block"
        >
          {content}
        </Link>
      </li>
    );
  }

  return <li className="group">{content}</li>;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
