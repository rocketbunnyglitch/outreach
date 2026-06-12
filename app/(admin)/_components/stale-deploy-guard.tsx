"use client";

/**
 * Stale-deploy guard (operator report 2026-06-12: "email replies won't
 * send (override)" — JC).
 *
 * After a deploy, an open tab still holds the PREVIOUS build's Server
 * Action IDs. Every action it posts (send, override-ack, status flip)
 * 404s server-side with "Failed to find Server Action". The existing
 * reload machinery only sees that failure when it reaches an error
 * boundary — but the send buttons CATCH the rejection and render an
 * error state, so the user just sees every click fail until they
 * happen to hard-refresh.
 *
 * This guard detects the skew STRUCTURALLY, independent of how app
 * code handles the rejection: a fetch carrying the `Next-Action`
 * header that comes back 404 can only mean the action id no longer
 * exists on the server — i.e. this bundle is stale. One
 * cooldown-guarded reload pulls the current build; Next restores
 * scroll/state via bfcache-style navigation, and the user's next
 * click works.
 *
 * Belt-and-braces: also listens for unhandled rejections matching the
 * stale-action message, covering action calls outside try/catch.
 */

import { looksLikeStaleServerAction, reloadForStaleDeploy } from "@/lib/chunk-reload";
import { useEffect } from "react";

function hasNextActionHeader(init: RequestInit | undefined, input: RequestInfo | URL): boolean {
  const probe = (h: HeadersInit | Headers | undefined): boolean => {
    if (!h) return false;
    if (h instanceof Headers) return h.has("Next-Action");
    if (Array.isArray(h)) return h.some(([k]) => k.toLowerCase() === "next-action");
    return Object.keys(h).some((k) => k.toLowerCase() === "next-action");
  };
  if (probe(init?.headers)) return true;
  if (input instanceof Request) return input.headers.has("Next-Action");
  return false;
}

export function StaleDeployGuard() {
  useEffect(() => {
    const origFetch = window.fetch;
    const wrapped: typeof window.fetch = async (input, init) => {
      const res = await origFetch(input, init);
      if (res.status === 404 && hasNextActionHeader(init, input)) {
        reloadForStaleDeploy();
      }
      return res;
    };
    window.fetch = wrapped;

    const onRejection = (e: PromiseRejectionEvent) => {
      if (looksLikeStaleServerAction(e.reason)) reloadForStaleDeploy();
    };
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      // Only restore if nobody else wrapped fetch after us.
      if (window.fetch === wrapped) window.fetch = origFetch;
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
