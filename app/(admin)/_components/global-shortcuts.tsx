"use client";

import { useShortcut } from "@/components/ui/shortcut-provider";
import { useRouter } from "next/navigation";

/**
 * Registers the app-wide navigation shortcuts. Mounted once in the
 * admin layout so it's always live regardless of which page is open.
 *
 * Pattern: `g <letter>` for "go to <page>" — matches Linear, Gmail,
 * Vercel, GitHub, etc. Two-key sequences with a 1.5s window so they
 * don't fire on accidental key presses.
 *
 * Single-letter shortcuts (n, /, etc.) are page-scoped and registered
 * by the page that owns them via useShortcut().
 */
export function GlobalShortcuts() {
  const router = useRouter();

  useShortcut({
    keys: "g d",
    label: "Go to Dashboard",
    group: "Navigation",
    handler: () => router.push("/"),
  });

  useShortcut({
    keys: "g c",
    label: "Go to City campaigns",
    group: "Navigation",
    handler: () => router.push("/city-campaigns"),
  });

  useShortcut({
    keys: "g a",
    label: "Go to All Crawls",
    group: "Navigation",
    handler: () => router.push("/all-crawls"),
  });

  useShortcut({
    keys: "g b",
    label: "Go to Brands",
    group: "Navigation",
    handler: () => router.push("/brands"),
  });

  useShortcut({
    keys: "g v",
    label: "Go to Venues",
    group: "Navigation",
    handler: () => router.push("/venues"),
  });

  useShortcut({
    keys: "g s",
    label: "Go to Staff analytics",
    group: "Navigation",
    handler: () => router.push("/admin/analytics"),
  });

  useShortcut({
    keys: "g i",
    label: "Go to Discover (venue scouting)",
    group: "Navigation",
    handler: () => router.push("/discover"),
  });

  // Show shortcuts cheatsheet is handled internally by the provider
  // via '?', but we register it here too so it shows up in the
  // cheatsheet listing itself.
  useShortcut({
    keys: "?",
    label: "Show keyboard shortcuts",
    group: "Help",
    handler: () => {
      // The provider's keydown handler already handles '?'. This is a
      // no-op registration that exists purely to show up in the
      // cheatsheet listing. (The provider's handler fires before
      // ours due to the event flow.)
    },
  });

  return null;
}
