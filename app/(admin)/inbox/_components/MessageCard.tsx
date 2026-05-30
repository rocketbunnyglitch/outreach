"use client";

/**
 * MessageCard — single message row in the thread conversation view.
 *
 * Gmail-style collapse behavior:
 *   - Newest message always rendered fully expanded
 *   - Older messages in a 3+ message thread render as a one-line
 *     summary by default (sender + first-line snippet + date)
 *   - Click anywhere on the collapsed header expands the message
 *   - Once expanded, clicking the header collapses again
 *
 * Single-message and two-message threads always stay expanded —
 * collapsing them just hides useful context for no benefit.
 */

import { cn } from "@/lib/cn";
import type { InboxThreadDetail } from "@/lib/inbox-data";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";

interface Props {
  message: InboxThreadDetail["messages"][number];
  isLast: boolean;
  defaultCollapsed: boolean;
}

export function MessageCard({ message, isLast, defaultCollapsed }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const isInbound = message.direction === "inbound";

  if (collapsed) {
    // One-line summary row. Click anywhere to expand.
    return (
      <li
        className={cn(
          "border-zinc-200/40 px-6 py-2.5 transition-colors hover:bg-zinc-50 dark:border-zinc-800/30 dark:hover:bg-zinc-900/40",
          !isLast && "border-b",
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label={`Expand message from ${message.fromName ?? message.fromAddress}`}
          className="flex w-full items-baseline justify-between gap-3 text-left"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {isInbound ? (
              <ArrowLeft className="h-3 w-3 shrink-0 text-emerald-500" />
            ) : (
              <ArrowRight className="h-3 w-3 shrink-0 text-blue-500" />
            )}
            <span className="shrink-0 font-medium text-sm">
              {message.fromName ?? message.fromAddress}
            </span>
            <span className="min-w-0 truncate text-xs text-zinc-500">
              {firstLine(message.bodyText)}
            </span>
          </div>
          <time
            dateTime={message.sentAt.toISOString()}
            className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums"
          >
            {formatTime(message.sentAt)}
          </time>
        </button>
      </li>
    );
  }

  // Expanded — full header + body.
  return (
    <li
      className={cn(
        "inbox-msg border-zinc-200/40 px-6 py-5 dark:border-zinc-800/30",
        !isLast && "border-b",
      )}
    >
      <header
        className="flex cursor-pointer items-start justify-between gap-3"
        onClick={() => {
          // Only allow collapsing if this isn't the newest message
          // (the latest always stays expanded).
          if (!isLast) setCollapsed(true);
        }}
        onKeyDown={(e) => {
          if (!isLast && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setCollapsed(true);
          }
        }}
        // biome-ignore lint/a11y/useSemanticElements: header acts as a button only when collapsible
        role={isLast ? undefined : "button"}
        tabIndex={isLast ? undefined : 0}
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm">
            {isInbound ? (
              <ArrowLeft className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5 text-blue-500" />
            )}
            <span className="font-medium">{message.fromName ?? message.fromAddress}</span>
            {message.fromName && (
              <span className="text-xs text-zinc-500">&lt;{message.fromAddress}&gt;</span>
            )}
          </p>
          {message.toAddresses.length > 0 && (
            <p className="mt-0.5 text-xs text-zinc-500">
              to {message.toAddresses.join(", ")}
              {message.ccAddresses.length > 0 && (
                <span> · cc {message.ccAddresses.join(", ")}</span>
              )}
            </p>
          )}
        </div>
        <time
          dateTime={message.sentAt.toISOString()}
          className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums"
        >
          {message.sentAt.toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
      </header>

      <div className="mt-3">
        {/*
          Render priority:
            1. bodySafeHtml — server-sanitized inbound HTML.
            2. bodyText — plain-text fallback.
            3. "(empty body)" — both null.
        */}
        {message.bodySafeHtml ? (
          <div
            className="inbox-prose max-w-prose text-sm text-zinc-800 dark:text-zinc-200"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side via DOMPurify; see lib/email-sanitize.ts
            dangerouslySetInnerHTML={{ __html: message.bodySafeHtml }}
          />
        ) : message.bodyText ? (
          <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-800 dark:text-zinc-200">
            {message.bodyText}
          </pre>
        ) : (
          <p className="text-xs text-zinc-500 italic">(empty body)</p>
        )}
      </div>

      {message.sentByStaffName && !isInbound && (
        <p className="mt-3 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Sent by {message.sentByStaffName}
        </p>
      )}
    </li>
  );
}

function firstLine(s: string | null): string {
  if (!s) return "";
  const stripped = s.trim();
  if (!stripped) return "";
  const eol = stripped.indexOf("\n");
  return (eol === -1 ? stripped : stripped.slice(0, eol)).slice(0, 140);
}

function formatTime(d: Date): string {
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
