"use client";

import { Button } from "@/components/ui/button";
import type { StaffMember } from "@/db/schema";
import { cn } from "@/lib/cn";
import { BarChart3, LogOut, Mail, RotateCcw } from "lucide-react";
import Link from "next/link";
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
 *   - Reset cached state — aggressive client-side reset. Clears
 *     localStorage, sessionStorage, IndexedDB databases, the browser's
 *     Cache Storage, every non-HttpOnly cookie (auth session cookie is
 *     HttpOnly so it survives), and unregisters any service workers.
 *     Then navigates to "/" with a cache-busting query parameter so the
 *     browser refetches fresh HTML + JS chunks instead of serving from
 *     its HTTP cache. This is the actual fix for "site won't load
 *     after a deploy" (stale HTML referencing chunk hashes that no
 *     longer exist on the server) and "stuck on a deleted route"
 *     situations. The user STAYS signed in.
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
      `Reset cached client state and reload?\n\nThis clears localStorage, sessionStorage, IndexedDB, the browser's Cache Storage for this site, all non-auth cookies, and unregisters any service workers — then reloads the homepage with a cache-busting query so the browser fetches fresh HTML and JS chunks. You will stay signed in.\n\nTip: if the app itself won't load (so you can't reach this menu), bookmark ${window.location.origin}/reset — that's a static page that does the same thing without depending on the app.`,
    );
    if (!confirmed) return;

    setResetting(true);

    // localStorage / sessionStorage — wrapped in try since some profiles
    // (e.g. with site-data permissions tightened) throw on access.
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
    // prior deploy on this origin could still own a cache. Also the
    // browser caches static asset responses here in some setups.
    if (typeof caches !== "undefined") {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        // ignore
      }
    }

    // Service workers — unregister any. Same defensive rationale.
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch {
        // ignore
      }
    }

    // IndexedDB — wipe every database the app might have opened. The
    // codebase doesn't use IDB directly but some libs do for caches.
    // databases() is supported on Chromium / Safari / Firefox 126+.
    if (typeof indexedDB !== "undefined") {
      try {
        const dbsFn = (
          indexedDB as IDBFactory & {
            databases?: () => Promise<{ name?: string }[]>;
          }
        ).databases;
        if (typeof dbsFn === "function") {
          const dbs = await dbsFn.call(indexedDB);
          await Promise.all(
            dbs.map(
              (db) =>
                new Promise<void>((resolve) => {
                  if (!db.name) {
                    resolve();
                    return;
                  }
                  const req = indexedDB.deleteDatabase(db.name);
                  req.onsuccess = () => resolve();
                  req.onerror = () => resolve();
                  req.onblocked = () => resolve();
                }),
            ),
          );
        }
      } catch {
        // ignore
      }
    }

    // Clear every non-HttpOnly cookie on this origin. The auth session
    // cookie is HttpOnly so this leaves it alone (the user stays signed
    // in), but app-level cookies like theme prefs, CSRF tokens, and
    // last-visited-route hints — any of which can be the actual cause
    // of a redirect loop or stuck render — get wiped.
    try {
      const cookies = document.cookie ? document.cookie.split(";") : [];
      for (const raw of cookies) {
        const name = raw.split("=")[0]?.trim();
        if (!name) continue;
        // Delete on multiple path/domain combinations because cookies
        // set at "/foo" can't be removed by deleting at "/".
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${window.location.hostname}`;
      }
    } catch {
      // ignore
    }

    // Navigate to root with a cache-busting query so the browser
    // doesn't serve cached HTML or chunks. This is the actual fix for
    // "site won't load after a deploy": the cached index.html references
    // chunk hashes that no longer exist on the server, so reloading the
    // SAME url returns the same broken HTML; changing the url (via
    // ?_reset=) forces a fresh fetch, and the fresh HTML has the new
    // chunk hashes. Going to "/" instead of the current path also
    // recovers from "user is stuck on a deleted route" situations.
    const cacheBust = `?_reset=${Date.now()}`;
    window.location.replace(`/${cacheBust}`);
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

          {/* Operator-facing analytics. Distinct from the admin
              /admin/analytics surface which can target any staffer;
              this routes to /me/activity which is auto-scoped to
              the caller's own id. Available to every signed-in
              user, not just admins -- "how am I doing this week"
              shouldn't require a manager. */}
          <Link
            href="/me/activity"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40"
          >
            <BarChart3 className="h-3.5 w-3.5 text-zinc-500" />
            <span className="flex flex-col leading-tight">
              <span className="text-zinc-900 dark:text-zinc-100">My activity</span>
              <span className="text-[10px] text-zinc-500">Your stats: calls, sends, replies</span>
            </span>
          </Link>

          {/* Operator-facing inbox health. Same self-scope rationale
              as /me/activity: the /admin/email-health view is
              admin-only and covers every account; this one surfaces
              the caller's own send-cap usage + sync status so a rep
              can self-monitor without paging a manager. */}
          <Link
            href="/me/inbox-health"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40"
          >
            <Mail className="h-3.5 w-3.5 text-zinc-500" />
            <span className="flex flex-col leading-tight">
              <span className="text-zinc-900 dark:text-zinc-100">Inbox health</span>
              <span className="text-[10px] text-zinc-500">Send cap, sync status, unread</span>
            </span>
          </Link>

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
