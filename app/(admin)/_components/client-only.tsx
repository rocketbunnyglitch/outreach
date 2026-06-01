"use client";

/**
 * <ClientOnly> — renders children only after the component mounts
 * on the client. Returns null during SSR and during the first
 * client render (before useEffect runs).
 *
 * When to use this
 * ----------------
 * Interactive UI that depends on browser-only state (localStorage,
 * WebSocket connections, scroll position, viewport queries) and
 * whose initial HTML is genuinely worthless — the user can't
 * interact with it until JS hydrates anyway.
 *
 * For these components, the server-rendered HTML is just a
 * placeholder that can never match the client's reality. Skipping
 * SSR entirely sidesteps React #418 hydration-mismatch errors that
 * can otherwise freeze the page.
 *
 * Examples:
 *   - WhosOnline (polls /api/presence + reads localStorage state)
 *   - MeetingMode (localStorage flag → conditional WebSocket layer)
 *   - Live-cursor overlays (PresenceCursors)
 *
 * When NOT to use this
 * --------------------
 * Anything that should be visible in the initial paint (KPIs,
 * data tables, navigation). Wrapping a critical UI element in
 * <ClientOnly> turns "above the fold" into "post-hydration"
 * and gives users a visible flash + worse Core Web Vitals.
 *
 * Layout shift
 * ------------
 * To prevent a layout shift when children appear, callers can
 * pass `fallback` — a server-rendered placeholder of the same
 * dimensions. The placeholder must NOT use any browser-only state
 * itself; it's there purely for SSR + first client render layout.
 *
 * Common pattern for the dashboard header is a fixed-size empty
 * box so the right-aligned elements don't jump when the real
 * widgets land.
 */

import { type ReactNode, useEffect, useState } from "react";

interface ClientOnlyProps {
  children: ReactNode;
  /** Optional placeholder shown during SSR + first client render
   *  to reserve layout space. Must be SSR-safe (no localStorage,
   *  no Date.now(), no random keys). */
  fallback?: ReactNode;
}

export function ClientOnly({ children, fallback = null }: ClientOnlyProps) {
  // mounted is false during SSR + first client render (since
  // useEffect hasn't run yet), then flips true on commit. The
  // useState initializer is the constant `false` — deterministic
  // across server and client, so hydration completes cleanly
  // BEFORE we swap in the real children.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <>{fallback}</>;
  return <>{children}</>;
}
