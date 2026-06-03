"use client";

import { Search } from "lucide-react";
import { type FormEvent, useState } from "react";

/**
 * Reference-doc search box. Submits to /api/reference/search (which uses the
 * Phase 0.4 retrieval helper -> Postgres full-text search), then highlights
 * matching entries in the TOC and scrolls to the first hit.
 *
 * Highlight uses the "info" tint (blue), not amber/rose, per the palette
 * reservations.
 */
export function ReferenceSearch({ slug }: { slug: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/reference/search?slug=${encodeURIComponent(slug)}&q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { codes: string[] };
      const matches = new Set(data.codes);
      const links = document.querySelectorAll<HTMLElement>(".reference-toc-link");
      for (const el of links) {
        const code = el.getAttribute("data-section-code") ?? "";
        const hit = matches.has(code);
        el.classList.toggle("bg-blue-100", hit);
        el.classList.toggle("dark:bg-blue-900/30", hit);
      }
      const first = data.codes[0];
      if (first) {
        document.getElementById(first)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={runSearch} className="relative">
      <Search className="-translate-y-1/2 absolute top-1/2 left-2 h-3.5 w-3.5 text-zinc-400" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the doc..."
        disabled={busy}
        className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pr-2 pl-7 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
    </form>
  );
}
