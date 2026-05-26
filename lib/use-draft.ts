"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Auto-save form draft to localStorage with a stable key.
 *
 * Pattern:
 *   const { value, setValue, clearDraft, savedAt } = useDraft({
 *     key: `remarks:${entryId}`,
 *     initial: serverValue,
 *     debounceMs: 400,
 *   });
 *
 * Behavior:
 *   • On mount: read from localStorage; if there's a stored draft
 *     AND it differs from the server value AND it's not stale (older
 *     than `staleAfterMs` — default 7 days), prefer it. Otherwise
 *     use the server value.
 *   • On setValue: update React state immediately, debounce
 *     localStorage write.
 *   • clearDraft(): explicit removal — call after a successful save
 *     so the next mount reads the server value cleanly.
 *   • savedAt: timestamp of last persisted write, lets the UI show
 *     'saved 2s ago' if it wants to.
 *
 * SSR-safe: defers all localStorage access until after mount.
 * Multi-tab safe: listens for storage events and syncs.
 *
 * Why not useFormState / useTransition? Those handle the SAVE; this
 * handles the WORK-IN-PROGRESS. If the operator types 'left voicemail
 * Tuesday will call again' into the remarks field, then accidentally
 * navigates away or their phone backgrounds Safari, that text is GONE
 * without this hook. With this hook, on remount the textarea shows
 * exactly what they typed.
 */

const STORAGE_PREFIX = "outreach.draft.";
const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface UseDraftOpts {
  /** Stable identifier — typically '<surface>:<entityId>:<field>' */
  key: string;
  /** Server-confirmed value to render when no draft exists */
  initial: string;
  /** Debounce window before writing to localStorage. Default 400ms. */
  debounceMs?: number;
  /** Drafts older than this are ignored. Default 7 days. */
  staleAfterMs?: number;
  /** When false, behaves as a plain useState — useful when an entity
      isn't yet identified (e.g. new venue form) so we don't write to
      a meaningless key. */
  enabled?: boolean;
}

interface StoredDraft {
  value: string;
  savedAt: number;
}

interface UseDraftReturn {
  value: string;
  setValue: (next: string) => void;
  /** Explicitly clear the persisted draft (e.g. after successful submit). */
  clearDraft: () => void;
  /** Epoch ms of last localStorage write, or null. */
  savedAt: number | null;
  /** True when the in-memory value differs from the last persisted value. */
  isDirty: boolean;
  /** True when the mount restored a previously-typed draft different
      from the server value — UI can surface a 'recovered draft' hint. */
  recovered: boolean;
}

export function useDraft({
  key,
  initial,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  enabled = true,
}: UseDraftOpts): UseDraftReturn {
  const storageKey = `${STORAGE_PREFIX}${key}`;
  const [value, setValueState] = useState<string>(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [lastWrittenValue, setLastWrittenValue] = useState<string>(initial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------
  // Mount: restore from storage if we have a fresher draft
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const stored: StoredDraft = JSON.parse(raw);
      if (typeof stored?.value !== "string" || typeof stored?.savedAt !== "number") return;

      // Drop stale drafts so we don't restore week-old typos
      if (Date.now() - stored.savedAt > staleAfterMs) {
        window.localStorage.removeItem(storageKey);
        return;
      }

      // Only restore if the draft genuinely differs from server. If
      // they match, the server already has what we typed — no point
      // flashing a 'recovered draft' hint at the operator.
      if (stored.value !== initial) {
        setValueState(stored.value);
        setLastWrittenValue(stored.value);
        setSavedAt(stored.savedAt);
        setRecovered(true);
      }
    } catch {
      // Corrupt entry → wipe it
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
    // Intentionally only run on mount — re-running when `initial`
    // changes would clobber a recovered draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------
  // Multi-tab sync — if another tab saves under the same key, pull
  // its value in. Last write wins, matches Sheets behavior.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== storageKey) return;
      if (!e.newValue) {
        // Another tab cleared the draft — we follow
        setValueState(initial);
        setSavedAt(null);
        return;
      }
      try {
        const stored: StoredDraft = JSON.parse(e.newValue);
        if (typeof stored.value === "string") {
          setValueState(stored.value);
          setLastWrittenValue(stored.value);
          setSavedAt(stored.savedAt);
        }
      } catch {
        // Ignore corrupt storage event
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [enabled, storageKey, initial]);

  // ---------------------------------------------------------------
  // Debounced write to storage on value change
  // ---------------------------------------------------------------
  const setValue = useCallback(
    (next: string) => {
      setValueState(next);
      if (!enabled || typeof window === "undefined") return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          // If the user typed back to the server-confirmed value, clear
          // the draft entirely — no point persisting an identity.
          if (next === initial) {
            window.localStorage.removeItem(storageKey);
            setSavedAt(null);
            setLastWrittenValue(next);
            return;
          }
          const payload: StoredDraft = { value: next, savedAt: Date.now() };
          window.localStorage.setItem(storageKey, JSON.stringify(payload));
          setSavedAt(payload.savedAt);
          setLastWrittenValue(next);
        } catch {
          // Storage quota exceeded or private-browsing in some browsers.
          // Fail open — the operator's typing still works, just doesn't
          // persist.
        }
      }, debounceMs);
    },
    [enabled, storageKey, initial, debounceMs],
  );

  // Flush pending debounce on unmount so a quickly-departed page still
  // persists the last few keystrokes
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const clearDraft = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSavedAt(null);
    setRecovered(false);
    setLastWrittenValue(value);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey, value]);

  return {
    value,
    setValue,
    clearDraft,
    savedAt,
    isDirty: value !== lastWrittenValue,
    recovered,
  };
}
