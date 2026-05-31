"use client";

/**
 * useDraftHydration — restores open drafts from the server on mount.
 *
 * Without this hook, drafts persist across route changes (because the
 * store lives at the layout level) but NOT across page refreshes (the
 * store is in-memory client state). This hook bridges the gap: on
 * first mount it calls listMyDrafts() and hydrates each into the
 * store with mode='minimized' so the operator sees them as restorable
 * tabs in the bottom-right stack without auto-expanding 5 composers
 * on every refresh.
 *
 * Idempotent — runs once per mount via a ref guard; subsequent
 * renders are no-ops. The store's hydrate() merge is also
 * idempotent (skips ids already present locally).
 */

import { useEffect, useRef } from "react";
import { listMyDrafts } from "../../_actions/email-drafts";
import { type ComposerInstance, useComposer } from "./composer-store";

export function useDraftHydration() {
  const { hydrate } = useComposer();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    listMyDrafts()
      .then((rows) => {
        if (rows.length === 0) return;
        const instances: ComposerInstance[] = rows.map((r) => ({
          id: r.id,
          // Minimized on restore so the operator opts into each one
          // rather than getting a wall of expanded composers.
          mode: "minimized",
          fromAccountId: r.connectedAccountId ?? "",
          to: r.toAddresses.join(", "),
          cc: r.ccAddresses.join(", "),
          bcc: r.bccAddresses.join(", "),
          showCc: r.ccAddresses.length > 0,
          showBcc: r.bccAddresses.length > 0,
          subject: r.subject,
          bodyText: r.bodyText,
          bodyHtml: r.bodyHtml,
          venueId: r.venueId,
          cityCampaignId: r.cityCampaignId,
          templateId: r.templateId,
          attachments: (r.attachments ?? []).map((a, i) => ({
            id: `${r.id}-att-${i}`,
            name: a.name,
            size: a.size,
            mime: a.mime,
            storage_key: a.storage_key,
          })),
          scheduledFor: r.scheduledFor,
          draftStatus: "saved",
          lastSavedAt: r.updatedAt,
          isAdmin: false,
          composeMode: (r.mode as ComposerInstance["composeMode"]) ?? "new",
          replyToThreadId: r.replyToThreadId ?? null,
          replyToMessageId: r.replyToMessageId ?? null,
          pendingLabelIds: r.pendingLabelIds ?? [],
          quotedHtml: r.quotedHtml ?? null,
        }));
        hydrate(instances);
      })
      .catch(() => {
        // Best-effort restore — failure leaves the operator with an
        // empty bottom-right stack, which is acceptable.
      });
  }, [hydrate]);
}
