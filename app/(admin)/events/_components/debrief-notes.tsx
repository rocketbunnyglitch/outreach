"use client";

/**
 * DebriefNotes (Phase 6.4) -- a single editable free-text debrief for the crawl,
 * filled in after the event runs. One running field (not a notes thread):
 * last-writer-wins, with who/when last saved shown beneath. Matches the venue
 * NotesSection visual language (card-surface, Textarea, Button).
 */

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import { ClipboardList, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveDebriefNotes } from "../_debrief-actions";

function fmt(iso: string | null): string {
  if (!iso) return "never";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function DebriefNotes({
  eventId,
  initialNotes,
  updatedAt,
  updatedByName,
}: {
  eventId: string;
  initialNotes: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(updatedAt);

  const dirty = draft !== (initialNotes ?? "");

  function save() {
    startTx(async () => {
      try {
        const res = await saveDebriefNotes({ eventId, notes: draft });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Couldn't save the debrief." });
          return;
        }
        setLastSavedAt(res.data.updatedAt);
        toast.show({ kind: "success", message: "Debrief saved." });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "events.debrief",
          fallback: "Couldn't save the debrief.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  return (
    <section className="card-surface flex flex-col gap-4 p-5">
      <header className="flex items-baseline justify-between">
        <h2 className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight">
          <ClipboardList className="h-4 w-4 text-zinc-500" />
          Post-event debrief
        </h2>
        <p className="hidden text-[10px] text-zinc-400 sm:block">
          Filled in after the crawl. One running note for the whole event.
        </p>
      </header>

      <Textarea
        name="debriefNotes"
        rows={6}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="How did the crawl go? What went well, what broke, venue follow-ups for next time."
        maxLength={16000}
        className="resize-y"
      />

      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] text-zinc-400">
          {lastSavedAt
            ? `Last saved ${fmt(lastSavedAt)}${updatedByName ? ` by ${updatedByName}` : ""}`
            : "Not yet saved"}
        </p>
        <Button type="button" onClick={save} disabled={pending || !dirty} size="sm">
          {pending && <Loader2 className="h-3 w-3 animate-spin" />}
          Save debrief
        </Button>
      </div>
    </section>
  );
}
