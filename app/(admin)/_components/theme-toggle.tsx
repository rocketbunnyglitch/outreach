"use client";

/**
 * ThemeToggle — two-state pill for light / dark.
 *
 * Reads + writes localStorage 'theme-pref'. On change, dispatches a
 * 'theme-pref-change' event which the inline script in app/layout.tsx
 * listens for and re-applies the .light/.dark class on <html>.
 *
 * On first paint we render in an indeterminate state to avoid a server/
 * client mismatch; once mounted we read the stored pref. If nothing is
 * stored we fall back to the OS preference so dark-mode-only users
 * don't see a white flash on first visit, but only "light" and "dark"
 * are user-pickable values now — the explicit "match OS" option was
 * removed at the operator's request.
 */

import { cn } from "@/lib/cn";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { updateUserPreferences } from "../_actions/user-preferences";

type ThemePref = "light" | "dark";

const OPTIONS: Array<{
  value: ThemePref;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}> = [
  { value: "light", label: "Light", icon: Sun, title: "Light mode" },
  { value: "dark", label: "Dark", icon: Moon, title: "Dark mode" },
];

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref | null>(null);

  useEffect(() => {
    let stored = localStorage.getItem("theme-pref") as ThemePref | "system" | null;
    // Migration: anyone with the old "system" value gets resolved to
    // whatever their OS currently prefers so the pill doesn't render
    // ambiguous. Subsequent picks overwrite this.
    if (stored === "system" || stored === null) {
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      stored = prefersDark ? "dark" : "light";
    }
    setPref(stored as ThemePref);
  }, []);

  function choose(next: ThemePref) {
    setPref(next);
    try {
      localStorage.setItem("theme-pref", next);
    } catch {
      // localStorage can throw in private windows; ignore
    }
    window.dispatchEvent(new Event("theme-pref-change"));
    // Persist to the profile so the choice follows the operator across
    // devices. Best-effort -- localStorage already drives this device.
    void updateUserPreferences({ themePref: next }).catch(() => {});
  }

  return (
    <div
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-zinc-200 bg-zinc-50 p-0.5",
        "dark:border-zinc-800 dark:bg-zinc-900",
      )}
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const selected = pref === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            title={opt.title}
            onClick={() => choose(opt.value)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded transition-colors",
              selected
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
            )}
          >
            <Icon className="h-3 w-3" />
            <span className="sr-only">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
