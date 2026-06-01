"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Mail, MapPin, MessageSquare, Phone } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

interface OutreachLogEntry {
  id: string;
  channel: string;
  outcome: string;
  subject: string | null;
  notes: string | null;
  createdAt: Date | string;
  staffName: string | null;
  outreachBrandName: string | null;
}

interface Props {
  venueId: string;
  outreachBrands: { id: string; displayName: string }[];
  entries: OutreachLogEntry[];
  action: (
    prev: unknown,
    fd: FormData,
  ) => Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
  }>;
  defaultOutreachBrandId?: string;
}

/**
 * Append-only outreach log for a venue. Shown on the venue edit page.
 *
 * Layout: small form at the top to log a new touchpoint, then a vertical
 * list of past entries (newest first), grouped by month for scanability.
 */
export function OutreachLogSection({
  venueId,
  outreachBrands,
  entries,
  action,
  defaultOutreachBrandId,
}: Props) {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-2xl tracking-tight ">Outreach history</h2>
        <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </header>

      <LogEntryForm
        venueId={venueId}
        outreachBrands={outreachBrands}
        action={action}
        defaultOutreachBrandId={defaultOutreachBrandId}
      />

      {entries.length === 0 ? (
        <Card className="border-dashed bg-transparent p-6 text-center text-sm text-zinc-500">
          No outreach logged yet. The first entry above will appear here.
        </Card>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} />
          ))}
        </ol>
      )}
    </section>
  );
}

function LogEntryForm({
  venueId,
  outreachBrands,
  action,
  defaultOutreachBrandId,
}: Pick<Props, "venueId" | "outreachBrands" | "action" | "defaultOutreachBrandId">) {
  const [state, formAction] = useActionState(action, null);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="font-medium text-xs text-zinc-500 uppercase tracking-widest">
        Log a touchpoint
      </p>

      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}
      {state?.ok && <Alert tone="success">Touchpoint logged.</Alert>}

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="venueId" value={venueId} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="outreachBrandId">Outreach brand</Label>
            <Select name="outreachBrandId" required defaultValue={defaultOutreachBrandId}>
              <SelectTrigger id="outreachBrandId">
                <SelectValue placeholder="Pick brand" />
              </SelectTrigger>
              <SelectContent>
                {outreachBrands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel">Channel</Label>
            <Select name="channel" required defaultValue="email">
              <SelectTrigger id="channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="form">Web form</SelectItem>
                <SelectItem value="in_person">In person</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="outcome">Outcome</Label>
            <Select name="outcome" required defaultValue="sent">
              <SelectTrigger id="outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="bad_email">Bad email</SelectItem>
                <SelectItem value="bounced">Bounced</SelectItem>
                <SelectItem value="no_answer">No answer</SelectItem>
                <SelectItem value="voicemail">Voicemail</SelectItem>
                <SelectItem value="callback_requested">Callback req.</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="interested">Interested</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="wrong_number">Wrong number</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="subject">Subject (optional)</Label>
          <Input id="subject" name="subject" placeholder="Halloween crawl — Toronto" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            placeholder="Spoke with Alex, asked for venue info pack"
          />
        </div>

        <SubmitButton />
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="sm" className="self-end">
      {pending ? "Logging…" : "Log touchpoint"}
    </Button>
  );
}

function EntryRow({ entry }: { entry: OutreachLogEntry }) {
  const date = new Date(entry.createdAt);
  return (
    <li className="flex items-start gap-3 rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <ChannelIcon channel={entry.channel} />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium text-sm capitalize">{entry.channel}</span>
          <span className="text-zinc-300">·</span>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {entry.outcome.replace(/_/g, " ")}
          </span>
          {entry.outreachBrandName && (
            <>
              <span className="text-zinc-300">·</span>
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
                {entry.outreachBrandName}
              </span>
            </>
          )}
        </div>
        {entry.subject && (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{entry.subject}</p>
        )}
        {entry.notes && <p className="text-xs text-zinc-500">{entry.notes}</p>}
        <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-wider">
          {date.toLocaleString("en-US")}
          {entry.staffName && ` · ${entry.staffName}`}
        </p>
      </div>
    </li>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  const className = "h-4 w-4 text-zinc-400";
  switch (channel) {
    case "email":
      return <Mail className={className} aria-hidden="true" />;
    case "call":
      return <Phone className={className} aria-hidden="true" />;
    case "sms":
    case "instagram":
      return <MessageSquare className={className} aria-hidden="true" />;
    case "in_person":
      return <MapPin className={className} aria-hidden="true" />;
    default:
      return <FileText className={className} aria-hidden="true" />;
  }
}
