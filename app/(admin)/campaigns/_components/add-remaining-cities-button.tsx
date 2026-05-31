"use client";

/**
 * AddRemainingCitiesButton — one-click admin action that pulls every
 * city in the DB not already in this campaign and adds them all at
 * MAX(existing priority) + 1.
 *
 * Operator workflow: after manually setting P1-5 cities, click this
 * to dump every other city into P6 in a single shot. A second click
 * later would catch any newly-created cities at P7, etc.
 *
 * Lives next to BulkAddCities as a sibling sweep action. Hidden when
 * the operator isn't an admin (matches DeleteCampaignButton's gate).
 */

import { addRemainingCitiesAtNextPriority } from "@/app/(admin)/campaigns/_actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ListPlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

interface Props {
  campaignId: string;
  isAdmin: boolean;
}

export function AddRemainingCitiesButton({ campaignId, isAdmin }: Props) {
  const [pending, startTx] = useTransition();
  const toast = useToast();
  const router = useRouter();

  if (!isAdmin) return null;

  function go() {
    startTx(async () => {
      const r = await addRemainingCitiesAtNextPriority({ campaignId });
      if (!r.ok) {
        toast.show({
          kind: "error",
          message: r.error ?? "Couldn't add remaining cities.",
        });
        return;
      }
      if (r.data.added === 0) {
        toast.show({
          kind: "info",
          message: "Every city is already in this campaign.",
        });
        return;
      }
      toast.show({
        kind: "success",
        message: `Added ${r.data.added} ${r.data.added === 1 ? "city" : "cities"} at priority ${r.data.priority}.`,
      });
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={go}
      disabled={pending}
      title="Add every unassigned city in the database to this campaign at the next priority number."
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />}
      Add remaining cities (next P)
    </Button>
  );
}
