"use client";

/**
 * Inbox keyboard shortcuts — Gmail-muscle-memory bindings.
 *
 * Bindings (single-letter, no modifier):
 *   j  - next thread
 *   k  - previous thread
 *   r  - reply (focus reply composer)
 *   e  - archive thread
 *   a  - assign thread (focus assignment picker if present)
 *   /  - focus search input
 *   ?  - show shortcut help
 *
 * Modifier shortcuts:
 *   cmd+k / ctrl+k  - command palette (already wired elsewhere)
 *   cmd+Enter       - send reply (handled by the popout composer)
 *
 * Rules:
 *   - Single-letter shortcuts fire ONLY when no input/textarea/
 *     contentEditable has focus. We don't want "j" to navigate
 *     threads while the user is typing the letter j in a reply.
 *   - We use keydown (not keypress) so the keys work consistently
 *     across browsers + capture modifier combinations correctly.
 *   - The hook returns the shortcuts map so the help dialog can
 *     render an authoritative list.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export interface ShortcutMap {
  /** Navigate to the next thread in the visible list. */
  next?: () => void;
  /** Navigate to the previous thread in the visible list. */
  prev?: () => void;
  /** Focus the reply composer (expanding it if collapsed). */
  reply?: () => void;
  /** Archive the current thread. */
  archive?: () => void;
  /** Focus the assignment picker. */
  assign?: () => void;
  /** Focus the search input (typically the command palette trigger). */
  search?: () => void;
  /** Show the shortcuts help dialog. */
  showHelp?: () => void;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useInboxShortcuts(map: ShortcutMap) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Modifier-driven shortcuts handled by individual components
      // (cmd+enter in the popout composer, cmd+k by the palette mount).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (isTyping(e.target)) return;

      switch (e.key) {
        case "j":
          if (map.next) {
            e.preventDefault();
            map.next();
          }
          break;
        case "k":
          if (map.prev) {
            e.preventDefault();
            map.prev();
          }
          break;
        case "r":
          if (map.reply) {
            e.preventDefault();
            map.reply();
          }
          break;
        case "e":
          if (map.archive) {
            e.preventDefault();
            map.archive();
          }
          break;
        case "a":
          if (map.assign) {
            e.preventDefault();
            map.assign();
          }
          break;
        case "/":
          if (map.search) {
            e.preventDefault();
            map.search();
          }
          break;
        case "?":
          if (map.showHelp) {
            e.preventDefault();
            map.showHelp();
          }
          break;
        default:
          break;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // The router dependency keeps the closure fresh if Next swaps
    // the router instance (rare; defensive).
  }, [map, router]);
}

/** Static list for the help dialog. */
export const SHORTCUT_HELP: Array<{ keys: string; label: string }> = [
  { keys: "j", label: "Next thread" },
  { keys: "k", label: "Previous thread" },
  { keys: "r", label: "Reply" },
  { keys: "e", label: "Archive" },
  { keys: "a", label: "Assign" },
  { keys: "/", label: "Search" },
  { keys: "?", label: "Show shortcuts" },
  { keys: "⌘+Enter", label: "Send reply (when composer is open)" },
  { keys: "⌘+K", label: "Command palette" },
];
