"use client";

/**
 * CampaignGmailLabelField - campaign-level control for the Gmail label the
 * engine auto-applies to threads it sends for this campaign (mirrored to
 * Gmail). Admins get an inline input + save; non-admins see the value
 * read-only. The city name is applied as a second label automatically, so this
 * field is just the campaign tag (e.g. "halloween 2026").
 */

import { useToast } from "@/components/ui/toast";
import { Loader2, Tag } from "lucide-react";
import { useState, useTransition } from "react";
import { setCampaignGmailLabel } from "../_actions";

export function CampaignGmailLabelField({
  campaignId,
  initialLabel,
  isAdmin,
}: {
  campaignId: string;
  initialLabel: string | null;
  isAdmin: boolean;
}) {
  const toast = useToast();
  const [value, setValue] = useState(initialLabel ?? "");
  const [saved, setSaved] = useState(initialLabel ?? "");
  const [pending, startTransition] = useTransition();

  if (!isAdmin) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <Tag className="h-3.5 w-3.5 text-zinc-400" />
        <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
          Gmail label
        </span>
        <span>{saved ? saved : <span className="text-zinc-400">none</span>}</span>
      </div>
    );
  }

  const dirty = value.trim() !== saved.trim();

  const save = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("campaignId", campaignId);
      fd.set("label", value.trim());
      const res = await setCampaignGmailLabel(null, fd);
      if (res.ok) {
        setSaved(value.trim());
        toast.show({
          kind: "success",
          message: value.trim() ? "Gmail label saved." : "Gmail label cleared.",
        });
      } else {
        toast.show({ kind: "error", message: res.error ?? "Could not save label." });
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Tag className="h-3.5 w-3.5 text-zinc-400" />
      <label
        htmlFor="campaign-gmail-label"
        className="font-mono text-xs text-zinc-500 uppercase tracking-widest"
      >
        Gmail label
      </label>
      <input
        id="campaign-gmail-label"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty && !pending) save();
        }}
        placeholder="e.g. halloween 2026"
        maxLength={200}
        className="w-48 rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="button"
        onClick={save}
        disabled={!dirty || pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Save
      </button>
    </div>
  );
}
