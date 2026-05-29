"use client";

import { Button } from "@/components/ui/button";
import type { StaffMember } from "@/db/schema";
import { cn } from "@/lib/cn";
import { LogOut, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "../_actions";

interface UserMenuProps {
  staff: Pick<StaffMember, "displayName" | "primaryEmail" | "role">;
  provider: string;
}

/**
 * Top-nav user display. Avatar is the trigger; opens a small dropdown
 * with:
 *   - Header (display name + role)
 *   - Reset cached state — clears localStorage + sessionStorage +
 *     unregisters any service workers + purges Cache Storage, then
 *     hard-reloads the current page. The auth session cookie is
 *     preserved, so the user STAYS logged in — this is meant to
 *     recover from the "site times out only in this Chrome profile"
 *     class of issues (stale cache, leftover client state, etc.)
 *     without forcing a re-login.
 *   - Sign out — calls the existing signOutAction.
 *
 * Outside-click + Escape close the dropdown.
 */
export function UserMenu({ staff, provider }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleReset() {
    const confirmed = window.confirm(
      "Reset cached client state and reload?\n\n" +
        "This clears localStorage, sessionStorage, the browser's Cache Storage for this site, " +
        "and unregisters any service workers. You will stay signed in. " +
        "Use this if the site is hanging or behaving oddly only in this Chrome profile.",
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      // localStorage / sessionStorage — wrapped in try since some
      // profiles (e.g. with site-data permissions tightened) throw on
      // access.
      try {
        window.localStorage.clear();
      } catch {
        // ignore
      }
      try {
        window.sessionStorage.clear();
      } catch {
        // ignore
      }

      // Cache Storage API — purge anything cached for this origin.
      // Defensive; we don't register a SW today but a stale one from a
      // prior deploy on this origin could still own a cache.
      if (typeof caches !== "undefined") {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        } catch {
          // ignore
        }
      }

      // Service workers — unregister any. Same defensive rationale as
      // above: there isn't one in the codebase right now, but a stale
      // one from a previous deploy can still be the culprit.
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        } catch {
          // ignore
        }
      }
    } finally {
      // Hard-reload the current path so the next request re-fetches
      // everything fresh. We use location.replace so the broken state
      // doesn't sit in the history's back-entry. The session cookie is
      // HttpOnly and untouched by the above, so the user stays signed in.
      const target = window.location.pathname + window.location.search;
      window.location.replace(target || "/");
    }
  }

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-3">
      <div className="hidden flex-col items-end leading-tight sm:flex">
        <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
          {staff.displayName}
        </span>
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
          {staff.role}
          {provider === "dev-staff-impersonate" && " · dev"}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Account · ${staff.displayName}`}
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 dark:focus-visible:ring-zinc-700"
      >
        <Avatar displayName={staff.displayName} />
      </button>

      {open && (
        <div role="menu" className="card-surface absolute top-full right-0 z-30 mt-2 w-64 p-2">
          {/* Header — name + email + role, mirrors the visible-row info
              but centralized so future menu items (theme, profile, etc.)
              have an anchor. */}
          <div className="border-zinc-200 border-b px-2 pt-1 pb-2 dark:border-zinc-800">
            <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
              {staff.displayName}
            </p>
            {staff.primaryEmail && (
              <p className="truncate text-[11px] text-zinc-500">{staff.primaryEmail}</p>
            )}
            <p className="mt-0.5 font-mono text-[10px] text-zinc-400 uppercase tracking-wider">
              {staff.role}
              {provider === "dev-staff-impersonate" && " · dev"}
            </p>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={handleReset}
            disabled={resetting}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-100/60 disabled:opacity-50 dark:hover:bg-zinc-800/40"
            title="Clear cached client state without signing out"
          >
            <RotateCcw className="h-3.5 w-3.5 text-zinc-500" />
            <span className="flex flex-col leading-tight">
              <span className="text-zinc-900 dark:text-zinc-100">
                {resetting ? "Resetting…" : "Reset cached state"}
              </span>
              <span className="text-[10px] text-zinc-500">
                If the site is hanging in this Chrome profile
              </span>
            </span>
          </button>

          <form action={signOutAction} className="mt-0.5">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <LogOut className="h-3.5 w-3.5 text-rose-500" />
              <span className="text-zinc-900 dark:text-zinc-100">Sign out</span>
            </button>
          </form>
        </div>
      )}

      {/* Keep a visible direct sign-out button on the row too, so the
          most common action is one click — the dropdown is for the less
          common reset + the menu header. */}
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="icon" title="Sign out">
          <LogOut className="h-4 w-4" />
          <span className="sr-only">Sign out</span>
        </Button>
      </form>
    </div>
  );
}

function Avatar({ displayName }: { displayName: string }) {
  const initials =
    displayName
      .split(/\s+/)
      .map((word) => word[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        "bg-zinc-900 font-medium font-mono text-[10px] text-zinc-50 tracking-wider",
        "dark:bg-zinc-100 dark:text-zinc-900",
      )}
    >
      {initials}
    </div>
  );
}
