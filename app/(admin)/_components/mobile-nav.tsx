"use client";

import { cn } from "@/lib/cn";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface NavItem {
  href: string;
  label: string;
  disabled?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/brands", label: "Brands" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/all-crawls", label: "All Crawls" },
  { href: "/crawl-matrix", label: "Crawl Matrix" },
  { href: "/calendar", label: "Calendar" },
  { href: "/inbox", label: "Inbox" },
  { href: "/send-queue", label: "Send Queue" },
  { href: "/wristbands", label: "Wristbands" },
  { href: "/cities", label: "Cities" },
  { href: "/venues", label: "Venues" },
  { href: "/cluster-builder", label: "Clusters" },
  { href: "/middle-groups", label: "Middles" },
  { href: "/goals", label: "Goals" },
  { href: "/tasks", label: "Tasks" },
  { href: "/discover", label: "Discover" },
  { href: "/import", label: "Import" },
  { href: "/templates", label: "Templates" },
  { href: "/settings/inboxes", label: "Settings" },
  { href: "/audit", label: "Audit" },
];

/**
 * Mobile nav drawer for the admin header.
 *
 * Renders as:
 *   • A hamburger button in the header (md:hidden) — desktop uses the
 *     full inline nav row
 *   • Tap the hamburger → backdrop fade-in + right-side panel slides
 *     in from the edge with the same nav items in a column
 *   • Tap a link, tap the X, tap the backdrop, or press Escape → close
 *
 * Active route highlighting matches the desktop NavLink behavior
 * (zinc tint + bold) so the operator's location is obvious on both
 * surfaces.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer whenever the route actually changes (handles client-
  // side nav inside the drawer).
  // biome-ignore lint/correctness/useExhaustiveDependencies: setOpen is stable
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    // Prevent body scroll while drawer is open
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-700 transition-colors hover:bg-zinc-100 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop — button so it's keyboard-accessible (Escape also closes via document handler) */}
      <button
        type="button"
        onClick={() => setOpen(false)}
        tabIndex={-1}
        aria-label="Close menu"
        className={cn(
          "fixed inset-0 z-50 cursor-default bg-zinc-900/40 backdrop-blur-sm transition-opacity duration-200 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Drawer */}
      <aside
        className={cn(
          "fixed top-0 right-0 z-50 h-dvh w-[min(88vw,20rem)] overflow-y-auto border-zinc-200 border-l bg-white shadow-2xl transition-transform duration-200 ease-out md:hidden dark:border-zinc-800 dark:bg-zinc-950",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-label="Mobile navigation"
      >
        <header className="sticky top-0 flex items-center justify-between border-zinc-200 border-b bg-white/95 px-5 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <p className="font-semibold tracking-tight">Menu</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <nav className="flex flex-col gap-0.5 p-3">
          {ITEMS.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800/80 dark:text-zinc-100"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/40",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
