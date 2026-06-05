"use client";

/**
 * Back button that returns the operator to wherever they came from
 * (tracker, dashboard, a city page, the venue list, ...) via the browser
 * history, instead of a hard-coded destination. Falls back to a sensible
 * default route when the page was opened directly (no in-app history).
 */

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function SmartBackButton({
  fallbackHref,
  label,
  className,
}: {
  fallbackHref: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        // history.length > 1 means there's a previous in-app page to go
        // back to. Read only in the handler (never during render) so it's
        // hydration-safe.
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className={className}
    >
      <ChevronLeft className="h-3 w-3" /> {label}
    </button>
  );
}
