"use client";

/**
 * Seeds the theme on a fresh device from the operator's saved profile
 * preference. localStorage stays the per-device source of truth once a
 * choice exists here; this only fills it in when the device has none yet
 * (e.g. a new browser), so the dark/light choice follows them across
 * devices. Renders nothing.
 */

import { useEffect } from "react";

export function ThemePrefHydrator({ dbTheme }: { dbTheme: "light" | "dark" | null }) {
  useEffect(() => {
    if (!dbTheme) return;
    try {
      if (localStorage.getItem("theme-pref")) return; // this device already chose
      localStorage.setItem("theme-pref", dbTheme);
      window.dispatchEvent(new Event("theme-pref-change"));
    } catch {
      // localStorage blocked (private window) -- ignore.
    }
  }, [dbTheme]);
  return null;
}
