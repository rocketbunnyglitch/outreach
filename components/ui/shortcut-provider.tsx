"use client";

import { cn } from "@/lib/cn";
import { Command, X } from "lucide-react";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Global keyboard shortcut layer.
 *
 * Pattern (Linear / Superhuman / Notion convention):
 *   • Single-key shortcuts work when no input/textarea is focused
 *   • Sequences (e.g. 'g d' for go-to-dashboard) have a 1.5s window
 *   • Modifier shortcuts (Cmd+K) work everywhere
 *   • '?' opens the cheatsheet
 *   • Esc closes the cheatsheet
 *
 * Each component registers the shortcuts it cares about; they're
 * deregistered on unmount so navigating between pages doesn't leak
 * handlers.
 *
 * Why not react-hotkeys-hook? We want fine control over sequence
 * handling, the cheatsheet display, and consistent behavior across
 * the app. ~150 lines of code beats a 30KB dep.
 */

interface Shortcut {
  /** Keys to press. Single-char ('j'), sequence ('g d'), or modifier ('mod+k'). */
  keys: string;
  /** Human label shown in the cheatsheet. */
  label: string;
  /** Logical group for the cheatsheet (e.g. 'Navigation', 'Editing'). */
  group: string;
  /** What to do when pressed. */
  handler: (event: KeyboardEvent) => void;
  /** When false, this shortcut is registered but inert. Use for context-
      sensitive shortcuts that only fire on certain pages. */
  enabled?: boolean;
  /** Stable id so re-registers replace rather than stack. */
  id: string;
}

interface ShortcutContextValue {
  register: (shortcut: Shortcut) => () => void;
  showCheatsheet: () => void;
  hideCheatsheet: () => void;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

/**
 * Access the shortcut context — useful when you need imperative
 * control over the cheatsheet (e.g. a 'Show shortcuts' button in
 * the top nav).
 */
export function useShortcutContext(): ShortcutContextValue {
  const ctx = useContext(ShortcutContext);
  if (!ctx) {
    return {
      register: () => () => {},
      showCheatsheet: () => {},
      hideCheatsheet: () => {},
    };
  }
  return ctx;
}

export function useShortcut(shortcut: Omit<Shortcut, "id"> & { id?: string }): void {
  const ctx = useContext(ShortcutContext);
  // Generate a stable id from the keys + label if not provided —
  // re-renders with the same keys+label won't cause register-storm
  const id = shortcut.id ?? `${shortcut.keys}::${shortcut.label}`;

  useEffect(() => {
    if (!ctx) return;
    const cleanup = ctx.register({ ...shortcut, id });
    return cleanup;
    // The handler may be inline so we'd re-register on every render
    // if we depended on it. The id keeps a stable identity, so we
    // intentionally pin the deps to just id + enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shortcut.enabled, ctx]);
}

// =========================================================================
// Provider — wires global keydown listener + cheatsheet UI
// =========================================================================

const SEQUENCE_WINDOW_MS = 1500;

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<Map<string, Shortcut>>(new Map());
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [pendingSequence, setPendingSequence] = useState<string>("");

  const register = useCallback((shortcut: Shortcut) => {
    setShortcuts((prev) => {
      const next = new Map(prev);
      next.set(shortcut.id, shortcut);
      return next;
    });
    return () => {
      setShortcuts((prev) => {
        const next = new Map(prev);
        next.delete(shortcut.id);
        return next;
      });
    };
  }, []);

  const showCheatsheet = useCallback(() => setCheatsheetOpen(true), []);
  const hideCheatsheet = useCallback(() => setCheatsheetOpen(false), []);

  // Sequence buffer reset
  useEffect(() => {
    if (!pendingSequence) return;
    const t = setTimeout(() => setPendingSequence(""), SEQUENCE_WINDOW_MS);
    return () => clearTimeout(t);
  }, [pendingSequence]);

  // Global keydown handler
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Cheatsheet always responds to Esc
      if (cheatsheetOpen && e.key === "Escape") {
        e.preventDefault();
        setCheatsheetOpen(false);
        return;
      }

      // Ignore key events that originate from an input/textarea/select
      // unless they're modifier-based (Cmd+K still works while typing
      // in an input). This matches the behavior of Sheets, Gmail, and
      // every productivity app.
      const target = e.target as HTMLElement | null;
      const inEditable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      const hasMod = e.metaKey || e.ctrlKey;

      if (inEditable && !hasMod) return;

      // '?' opens the cheatsheet (Shift+/ on most keyboards). Skip if
      // already open — we let Esc close it.
      if (e.key === "?" && !hasMod && !inEditable) {
        e.preventDefault();
        setCheatsheetOpen((v) => !v);
        return;
      }

      // Build a key descriptor matching our shortcut.keys grammar:
      //   • 'mod+k' for Cmd/Ctrl combos
      //   • single char like 'j' for plain keys
      //   • multi-char sequences are accumulated via pendingSequence
      const k = e.key.toLowerCase();
      const descriptor = hasMod ? `mod+${k}` : k;

      // Look for an exact-match shortcut (modifier or single-key)
      for (const s of shortcuts.values()) {
        if (s.enabled === false) continue;
        if (s.keys === descriptor) {
          e.preventDefault();
          s.handler(e);
          setPendingSequence("");
          return;
        }
      }

      // Sequence matching: only for single non-modifier keys
      if (!hasMod && !inEditable && k.length === 1 && /^[a-z0-9]$/.test(k)) {
        const nextSequence = pendingSequence ? `${pendingSequence} ${k}` : k;
        for (const s of shortcuts.values()) {
          if (s.enabled === false) continue;
          // Exact sequence match → fire
          if (s.keys === nextSequence) {
            e.preventDefault();
            s.handler(e);
            setPendingSequence("");
            return;
          }
          // Prefix match → accumulate for next keystroke
          if (s.keys.startsWith(`${nextSequence} `)) {
            setPendingSequence(nextSequence);
            return;
          }
        }
        // No match → reset the buffer
        setPendingSequence("");
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcuts, pendingSequence, cheatsheetOpen]);

    const value = useMemo(
    () => ({ register, showCheatsheet, hideCheatsheet }),
    [register, showCheatsheet, hideCheatsheet],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
      {cheatsheetOpen && (
        <Cheatsheet shortcuts={[...shortcuts.values()]} onClose={hideCheatsheet} />
      )}
      {pendingSequence && <SequenceIndicator sequence={pendingSequence} />}
    </ShortcutContext.Provider>
  );
}

// =========================================================================
// Cheatsheet panel
// =========================================================================

function Cheatsheet({ shortcuts, onClose }: { shortcuts: Shortcut[]; onClose: () => void }) {
  // Group + sort
  const groups = new Map<string, Shortcut[]>();
  for (const s of shortcuts) {
    if (s.enabled === false) continue;
    const group = s.group ?? "Other";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)?.push(s);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        tabIndex={-1}
        aria-label="Close"
        className="fixed inset-0 z-[200] cursor-default bg-zinc-900/40 backdrop-blur-sm"
      />
      <div className="fixed inset-0 z-[210] grid place-items-center p-4">
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <header className="flex items-center justify-between border-zinc-200 border-b px-5 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Command className="h-4 w-4 text-zinc-500" />
              <h2 className="font-semibold tracking-tight">Keyboard shortcuts</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="grid max-h-[70vh] grid-cols-1 gap-x-8 gap-y-6 overflow-y-auto p-6 sm:grid-cols-2">
            {sortedGroups.map(([group, items]) => (
              <section key={group}>
                <h3 className="mb-2 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.1em]">
                  {group}
                </h3>
                <ul className="space-y-1.5">
                  {items.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-zinc-700 dark:text-zinc-300">{s.label}</span>
                      <Kbd keys={s.keys} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <footer className="border-zinc-200 border-t px-5 py-2.5 text-center font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] dark:border-zinc-800">
            Press <Kbd keys="?" inline /> any time
          </footer>
        </div>
      </div>
    </>
  );
}

function Kbd({ keys, inline = false }: { keys: string; inline?: boolean }) {
  const parts = keys.split(" ");
  return (
    <span className={cn("inline-flex items-center gap-1", inline && "mx-0.5")}>
      {parts.map((p, i) => {
        const label = p
          .replace("mod", navigator.platform.includes("Mac") ? "⌘" : "Ctrl")
          .toUpperCase()
          .split("+")
          .map((s) => s.trim())
          .join(" ");
        return (
          <kbd
            // biome-ignore lint/suspicious/noArrayIndexKey: positional ordering is the identity
            key={i}
            className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1.5 font-mono text-[10px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {label}
          </kbd>
        );
      })}
    </span>
  );
}

// =========================================================================
// Sequence indicator — small bottom-left hint when a sequence is in flight
// =========================================================================

function SequenceIndicator({ sequence }: { sequence: string }) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[180] rounded-md border border-zinc-200 bg-white px-2 py-1 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.08em] shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      {sequence}
      <span className="ml-1 animate-pulse">_</span>
    </div>
  );
}
