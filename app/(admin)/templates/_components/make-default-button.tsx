"use client";

/**
 * MakeDefaultButton — inline "promote to default" for a template on
 * the /templates list. One click, no navigation; the page revalidates
 * itself via the action's revalidatePath.
 *
 * Hidden when the template is already default — the parent list
 * renders the existing Star + Badge for that case.
 */

import { Loader2, Star } from "lucide-react";
import { useTransition } from "react";
import { setTemplateAsDefault } from "../_actions";

interface Props {
  templateId: string;
}

export function MakeDefaultButton({ templateId }: Props) {
  const [pending, startTx] = useTransition();

  function run(e: React.MouseEvent) {
    // Templates list rows are Links — stop propagation so clicking
    // the button doesn't also navigate to the template detail page.
    e.preventDefault();
    e.stopPropagation();
    startTx(async () => {
      await setTemplateAsDefault(templateId);
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      title="Make this template the default for its (brand, stage)"
      className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[10px] text-zinc-600 uppercase tracking-widest hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-amber-950/30 dark:hover:text-amber-300"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className="h-3 w-3" />}
      Make default
    </button>
  );
}
