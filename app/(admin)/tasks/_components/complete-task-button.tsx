"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { completeTask } from "../_actions";

interface Props {
  taskId: string;
  version: number;
}

export function CompleteTaskButton({ taskId, version }: Props) {
  const [state, formAction, pending] = useActionState(completeTask, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={taskId} />
      <input type="hidden" name="version" value={version} />
      <Button
        type="submit"
        disabled={pending}
        variant="default"
        className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        Mark complete
      </Button>
      {state && !state.ok && state.error && (
        <p className="mt-2 text-rose-500 text-xs">{state.error}</p>
      )}
    </form>
  );
}
