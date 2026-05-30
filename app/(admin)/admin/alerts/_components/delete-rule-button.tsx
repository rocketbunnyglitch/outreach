"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { deleteAlertRule } from "../_actions";

interface Props {
  ruleId: string;
}

export function DeleteRuleButton({ ruleId }: Props) {
  const [pending, startTx] = useTransition();

  return (
    <button
      type="button"
      onClick={() => {
        if (!confirm("Delete this alert rule?")) return;
        const fd = new FormData();
        fd.set("ruleId", ruleId);
        startTx(async () => {
          await deleteAlertRule(null, fd);
        });
      }}
      disabled={pending}
      title="Delete alert rule"
      className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-0.5 font-mono text-[10px] text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/40 dark:bg-zinc-950 dark:text-rose-300 dark:hover:bg-rose-950/30"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
      Delete
    </button>
  );
}
