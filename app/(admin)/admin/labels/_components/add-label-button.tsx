"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { createTeamLabelAction } from "../_actions";

const COLORS = [
  { slug: "emerald", swatch: "bg-emerald-500" },
  { slug: "rose", swatch: "bg-rose-500" },
  { slug: "blue", swatch: "bg-blue-500" },
  { slug: "amber", swatch: "bg-amber-500" },
  { slug: "violet", swatch: "bg-violet-500" },
  { slug: "sky", swatch: "bg-sky-500" },
  { slug: "orange", swatch: "bg-orange-500" },
  { slug: "yellow", swatch: "bg-yellow-500" },
  { slug: "zinc", swatch: "bg-zinc-500" },
] as const;

export function AddLabelButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("zinc");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTx] = useTransition();

  function close() {
    setOpen(false);
    setName("");
    setColor("zinc");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("color", color);
    startTx(async () => {
      const result = await createTeamLabelAction(null, fd);
      if (result.ok) {
        close();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <Plus className="h-3.5 w-3.5" />
        Add label
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 px-4 pt-[12vh] pb-10 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          >
            <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-4 flex items-start justify-between gap-3">
                <h2 className="font-semibold text-lg tracking-tight">New label</h2>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-xs">Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    // biome-ignore lint/a11y/noAutofocus: modal field is the primary action
                    autoFocus
                    placeholder="Toronto Q2 2026"
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>

                <div className="flex flex-col gap-1">
                  <span className="font-medium text-xs">Color</span>
                  <div className="flex flex-wrap gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        type="button"
                        key={c.slug}
                        onClick={() => setColor(c.slug)}
                        aria-label={c.slug}
                        aria-pressed={color === c.slug}
                        className={`h-6 w-6 rounded-full ${c.swatch} ring-2 ring-offset-2 ring-offset-white transition-shadow dark:ring-offset-zinc-950 ${
                          color === c.slug ? "ring-zinc-700 dark:ring-zinc-300" : "ring-transparent"
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="rounded-md bg-rose-50 px-3 py-2 text-rose-700 text-xs dark:bg-rose-950/40 dark:text-rose-300">
                    {error}
                  </div>
                )}

                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending || !name.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-50 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
