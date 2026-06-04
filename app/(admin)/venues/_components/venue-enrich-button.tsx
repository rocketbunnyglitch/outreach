"use client";

import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { backfillVenueFromGoogle } from "../_actions";

// Friendly labels for the `updated` field keys the action returns, so the
// operator sees "Filled address, coordinates" rather than raw column names.
const FIELD_LABELS: Record<string, string> = {
  googlePlaceId: "Google Place ID",
  address: "address",
  phone: "phone",
  website: "website",
  location: "coordinates",
  name: "name",
};

/**
 * Per-venue "Enrich from Google" button for the venue detail page. Wraps the
 * existing backfillVenueFromGoogle action (which only fills BLANK fields, never
 * overwrites operator data) so an operator can fill a missing address, phone,
 * website, or lat/lng coordinates on demand. Refreshes the page on success so
 * the newly filled fields render.
 */
export function VenueEnrichButton({ venueId }: { venueId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function enrich() {
    setFeedback(null);
    startTransition(async () => {
      const result = await backfillVenueFromGoogle({ venueId });
      if (!result.ok) {
        setFeedback(result.error);
        return;
      }
      if (result.updated.length === 0) {
        setFeedback("Already complete - nothing to fill.");
        return;
      }
      const labels = result.updated.map((f) => FIELD_LABELS[f] ?? f);
      setFeedback(`Filled ${labels.join(", ")}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={enrich}
        disabled={pending}
        title="Use Google to fill any missing address, phone, website, coordinates, and Google Place ID"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Enrich from Google
      </Button>
      {feedback ? <p className="text-right text-xs text-zinc-500">{feedback}</p> : null}
    </div>
  );
}
