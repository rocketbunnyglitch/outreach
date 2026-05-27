"use client";

/**
 * PasteMapsUrl — paste a Google Maps URL into a single input, the
 * server resolves it to a place_id, and we add the venue + a cold-
 * outreach entry on the campaign in one shot.
 *
 * UX flow:
 *   1. Operator pastes a URL (share-sheet from the iOS Maps app, or
 *      a desktop maps.google.com/maps/place/... URL)
 *   2. Tap "Add"
 *   3. Server resolves → preview banner "Added Blue Bottle Cafe ·
 *      123 Queen St W · (416) 555-0192"
 *   4. Preview disappears after 5s, input clears, ready for the next
 *
 * Pasting an existing place_id (already in the directory) is fine:
 * addPlaceToCampaign dedupes by google_place_id, so it just attaches
 * the existing venue to the campaign.
 *
 * Failure surface: inline error message with concrete next-step text
 * (e.g. "this looks like a coords-only URL — tap the specific venue
 * on the map first, then share again").
 *
 * Cmd/Ctrl+Enter submits from inside the input.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Check, ClipboardPaste, Link2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addVenueFromMapsUrl } from "../_actions/city-map-actions";

interface Props {
  cityCampaignId: string;
}

interface ResolvedPreview {
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
}

export function PasteMapsUrl({ cityCampaignId }: Props) {
  const [url, setUrl] = useState("");
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedPreview | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear the preview after 5s so the operator can paste another without
  // it accumulating. Errors persist until the next paste.
  useEffect(() => {
    if (!resolved) return;
    const id = setTimeout(() => setResolved(null), 5000);
    return () => clearTimeout(id);
  }, [resolved]);

  function submit() {
    setError(null);
    setResolved(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Paste a Google Maps URL first.");
      inputRef.current?.focus();
      return;
    }
    startTx(async () => {
      const result = await addVenueFromMapsUrl({
        cityCampaignId,
        url: trimmed,
      });
      if (!result.ok) {
        setError(result.error ?? "Couldn't add that venue.");
        return;
      }
      setResolved(result.resolved ?? null);
      setUrl("");
      // Refresh the page so the cold-outreach table + city map both pick
      // up the new venue. Cheaper than calling individual revalidatePath
      // on this client.
      router.refresh();
    });
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      inputRef.current?.focus();
    } catch {
      // Clipboard read can fail under some browser privacy settings.
      // Fall back to the user pasting manually.
      inputRef.current?.focus();
    }
  }

  return (
    <section className="card-surface-quiet flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-semibold text-sm">
          <Link2 className="h-3.5 w-3.5 text-zinc-400" />
          Add a venue from Google Maps
        </h3>
        <p className="font-mono text-[10px] text-zinc-500">paste a maps link</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={paste}
          disabled={pending}
          className={cn(
            "shrink-0 rounded-md border border-zinc-300 px-2 py-1.5 text-[11px] text-zinc-700 transition-colors",
            "hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            "disabled:opacity-50",
          )}
          title="Paste from clipboard"
        >
          <ClipboardPaste className="h-3 w-3" />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          placeholder="https://maps.app.goo.gl/… or https://www.google.com/maps/place/…"
          disabled={pending}
          className={cn(
            "flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs",
            "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
            "dark:border-zinc-700 dark:bg-zinc-900",
          )}
        />
        <Button type="button" onClick={submit} disabled={pending || !url.trim()}>
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Add
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-800 text-xs dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
        >
          {error}
        </p>
      )}

      {resolved && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-emerald-900 text-xs dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <p className="flex items-center gap-1.5 font-medium">
            <Check className="h-3 w-3" />
            Added {resolved.name}
          </p>
          {(resolved.address || resolved.phone || resolved.website) && (
            <p className="mt-0.5 truncate font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
              {[resolved.address, resolved.phone, resolved.website].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
