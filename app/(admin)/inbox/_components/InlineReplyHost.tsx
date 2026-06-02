"use client";

/**
 * InlineReplyHost — renders the inline reply composer for a thread.
 *
 * The composer-store keeps every draft as a top-level instance.
 * ComposerHost renders fixed-position docked/expanded/fullscreen
 * windows in the bottom-right; minimized chips along the bottom.
 * This host renders the ONE instance whose mode === "inline" AND
 * whose replyToThreadId matches the active thread, anchored to the
 * bottom of the messages list — same physical location Gmail's web
 * UI uses for inline replies.
 *
 * Popout behavior: the composer-window's inline-mode header carries
 * a maximize button that calls setMode(id, "docked"). The same
 * composer-store instance keeps all draft content; the global
 * ComposerHost picks it up the moment its mode changes and renders
 * it in the bottom-right stack instead.
 *
 * If no inline draft exists for the thread, this host renders
 * nothing — the ThreadReplyButtons component above it remains the
 * entry point that creates the draft + flips it to inline mode.
 */

import { useComposer } from "@/app/(admin)/_components/composer/composer-store";
import { ComposerWindow } from "@/app/(admin)/_components/composer/composer-window";
import { useEffect, useState } from "react";

interface Props {
  threadId: string;
}

export function InlineReplyHost({ threadId }: Props) {
  const { composers } = useComposer();
  // Detect mobile (below lg) so a reply opens FULL-SCREEN on phones --
  // Gmail-mobile behavior -- instead of a cramped inline box. When
  // isMobile, ComposerWindow forces effectiveMode=fullscreen (a fixed
  // overlay with the quoted original below via QuotedThreadBlock).
  // matchMedia is read only in an effect (never during render), seeded
  // false, so SSR and first hydration match -- hydration-safe.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const inline = Array.from(composers.values()).find(
    (c) => c.mode === "inline" && c.replyToThreadId === threadId,
  );
  if (!inline) return null;

  // Mobile: full-screen overlay (the composer is position:fixed when
  // fullscreen, so it doesn't need the in-thread wrapper).
  if (isMobile) {
    return <ComposerWindow instance={inline} index={0} isMobile />;
  }
  // Desktop: anchored inline surface at the bottom of the thread.
  return (
    <div className="border-zinc-200/80 border-t bg-white dark:border-zinc-800/60 dark:bg-zinc-950">
      <ComposerWindow instance={inline} index={0} isMobile={false} />
    </div>
  );
}
