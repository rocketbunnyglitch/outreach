"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { upsertAlertRule } from "../_actions";

interface Props {
  connectedAccountId: string;
  ruleLabels: Record<string, string>;
  ruleUnits: Record<string, string>;
}

export function AlertRuleForm({ connectedAccountId, ruleLabels, ruleUnits }: Props) {
  const [pending, startTx] = useTransition();
  const firstKind = Object.keys(ruleLabels)[0] ?? "";
  const [selectedKind, setSelectedKind] = useState(firstKind);
  const toast = useToast();
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const kindLabel = ruleLabels[String(fd.get("ruleKind") ?? "")] ?? "Alert rule";
        startTx(async () => {
          const r = await upsertAlertRule(null, fd);
          if (r && !r.ok) {
            toast.show({ kind: "error", message: r.error ?? "Couldn't save alert rule." });
            return;
          }
          toast.show({ kind: "success", message: `${kindLabel} saved.` });
          form.reset();
          router.refresh();
        });
      }}
      className="mt-3 flex flex-col gap-2 text-xs"
    >
      <input type="hidden" name="connectedAccountId" value={connectedAccountId} />
      <label className="flex flex-col gap-1">
        <span className="font-medium">Rule kind</span>
        <select
          name="ruleKind"
          required
          value={selectedKind}
          onChange={(e) => setSelectedKind(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {Object.entries(ruleLabels).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Threshold</span>
        <input
          name="threshold"
          type="number"
          step="any"
          min="0"
          required
          placeholder="e.g. 0.05"
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-[10px] text-zinc-500">Units: {ruleUnits[selectedKind] ?? "-"}</span>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Channels</legend>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="channels" value="email" defaultChecked />
          <span>email</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="channels" value="slack" />
          <span>slack (requires ALERT_SLACK_WEBHOOK_URL)</span>
        </label>
      </fieldset>
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" name="enabled" value="1" defaultChecked />
        <span>enabled</span>
      </label>
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Save rule
      </Button>
    </form>
  );
}
