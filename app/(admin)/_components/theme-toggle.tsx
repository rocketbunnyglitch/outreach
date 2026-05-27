"use client";

/**
 * ThemeToggle — three-state segmented toggle for light / system / dark.
 *
 * Reads + writes localStorage 'theme-pref'. On change, dispatches a
 * 'theme-pref-change' event which the inline script in app/layout.tsx
 * listens for and re-applies the .light/.dark class on <html>.
 *
 * Why three states (not just light/dark)?
 *   - "system" follows the OS, which is what most operators want most of
 *     the time (their OS already matches their environment).
 *   - Operators who want to override per-device-or-task (light mode for
 *     a screenshare with a client, dark mode for late-night sends) can
 *     pin it.
 *
 * Styling: minimal pill matching the slim top bar. No icons inside the
 * pill — just the labels. Lucide sun/moon/laptop are still imported and
 * used as the bare-bones tooltip helper above each option.
 */

import { cn } from "@/lib/cn";
import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemePref = "light" | "system" | "dark";

const OPTIONS: Array<{
  value: ThemePref;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}> = [
  { value: "light", label: "Light", icon: Sun, title: "Force light mode" },
  { value: "system", label: "Auto", icon: Laptop, title: "Match your OS" },
  { value: "dark", label: "Dark", icon: Moon, title: "Force dark mode" },
];

export function ThemeToggle() {
  // We render in an indeterminate state on first paint to avoid mismatching
  // server (no localStorage) vs client. Once mounted we read the pref.
  const [pref, setPref] = useState<ThemePref | null>(null);

  useEffect(() => {
    const stored = (localStorage.getItem("theme-pref") as ThemePref | null) ?? "system";
    setPref(stored);
  }, []);

  function choose(next: ThemePref) {
    setPref(next);
    try {
      localStorage.setItem("theme-pref", next);
    } catch {
      // localStorage can throw in private windows; ignore
    }
    window.dispatchEvent(new Event("theme-pref-change"));
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
