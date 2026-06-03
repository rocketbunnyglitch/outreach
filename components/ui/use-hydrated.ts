"use client";

import { useEffect, useState } from "react";

/**
 * useHydrated — returns false on the server AND on the client's FIRST render
 * (so SSR output matches first client render), then true after mount.
 *
 * Use this to gate any value that depends on the wall clock (`Date.now()`,
 * `new Date()`), randomness, or browser-only state when that value is
 * RENDERED (as text, a className, or an attribute). Rendering such a value
 * directly makes the server HTML differ from the client's first render →
 * React #418 hydration mismatch → the page bails hydration and FREEZES.
 *
 * Pattern:
 *   const hydrated = useHydrated();
 *   <span suppressHydrationWarning>{hydrated ? formatRelative(t) : ""}</span>
 *
 * The real value appears immediately after mount (one tick later); the user
 * never notices, and hydration stays deterministic.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
