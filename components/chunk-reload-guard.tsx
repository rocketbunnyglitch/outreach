"use client";

import { maybeReloadForChunkError } from "@/lib/chunk-reload";
import { useEffect } from "react";

/**
 * Window-level net for stale-chunk failures that surface as an unhandled
 * promise rejection from a failed dynamic import() (the common case) or a
 * raw window error event, rather than through a React error boundary.
 * Mounted once in the root layout. Renders nothing.
 */
export function ChunkReloadGuard() {
  useEffect(() => {
    // Mark hydration complete so the pre-React diagnostic watchdog
    // (lib/client-diag.ts) knows React actually booted in this tab.
    (window as unknown as { __perseHydrated?: boolean }).__perseHydrated = true;
    function onError(event: ErrorEvent) {
      maybeReloadForChunkError(event.error ?? event.message);
    }
    function onRejection(event: PromiseRejectionEvent) {
      maybeReloadForChunkError(event.reason);
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
