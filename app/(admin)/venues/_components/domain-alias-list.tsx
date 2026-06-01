"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AtSign, Globe, Loader2, Trash2 } from "lucide-react";
import { useActionState, useRef, useState } from "react";

export interface DomainAliasRow {
  id: string;
  domain: string;
  notes: string | null;
  /** Preformatted on the server to avoid client-side date/locale work
   *  during render (which can trip hydration). */
  createdAtLabel: string;
  createdByName: string | null;
}

type AddAction = (
  prev: unknown,
  formData: FormData,
) => Promise<{
  ok: boolean;
  error?: string;
  data?: { domain: string; retroactivelyAttached: number };
}>;

type RemoveAction = (
  prev: unknown,
  formData: FormData,
) => Promise<{ ok: boolean; error?: string; data?: { id: string } }>;

interface DomainAliasListProps {
  venueId: string;
  aliases: DomainAliasRow[];
  addAction: AddAction;
  removeAction: RemoveAction;
}

/**
 * Domain aliases panel for the venue detail page. Lets operators mark
 * email DOMAINS that belong to this venue's brand / parent group, so
 * inbound mail from a manager at e.g. @taohospitalitygroup.com attaches
 * to the venue automatically even though it doesn't match the venue's
 * own address. Complements the per-address alternate_emails list.
 */
export function DomainAliasList({
  venueId,
  aliases,
  addAction,
  removeAction,
}: DomainAliasListProps) {
  const [addState, doAdd, adding] = useActionState(addAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [domainDraft, setDomainDraft] = useState("");

  // Clear the input on a successful add.
  if (addState?.ok && domainDraft !== "" && !adding) {
    setDomainDraft("");
    formRef.current?.reset();
  }

  return (
    <section className="card-surface flex flex-col gap-4 p-5">
      <header className="flex items-baseline justify-between">
        <h2 className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight">
          <Globe className="h-4 w-4 text-zinc-500" />
          Domain aliases
          {aliases.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono font-normal text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {aliases.length}
            </span>
          )}
        </h2>
        <p className="hidden max-w-sm text-right text-[10px] text-zinc-400 sm:block">
          Mail from anyone at these domains is treated as this venue, even when the address differs
          from the venue's own.
        </p>
      </header>

      <form ref={formRef} action={doAdd} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <input type="hidden" name="venueId" value={venueId} />
        <Input
          name="domain"
          value={domainDraft}
          onChange={(e) => setDomainDraft(e.target.value)}
          placeholder="taohospitalitygroup.com"
          autoComplete="off"
          spellCheck={false}
          maxLength={253}
          className="sm:flex-1"
        />
        <Input
          name="notes"
          placeholder="Note (optional) e.g. Tao owns Lavelle"
          autoComplete="off"
          maxLength={500}
          className="sm:flex-1"
        />
        <Button type="submit" disabled={adding || domainDraft.trim().length === 0} size="sm">
          {adding && <Loader2 className="h-3 w-3 animate-spin" />}
          Add domain
        </Button>
      </form>
      {addState && !addState.ok && addState.error && <Alert tone="error">{addState.error}</Alert>}
      {addState?.ok && addState.data && (
        <Alert tone="success">
          {addState.data.retroactivelyAttached > 0
            ? `Added ${addState.data.domain}. ${addState.data.retroactivelyAttached} historical thread${addState.data.retroactivelyAttached === 1 ? "" : "s"} retroactively attached to this venue.`
            : `Added ${addState.data.domain}. No historical threads from this domain were unmatched.`}
        </Alert>
      )}

      {aliases.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 border-dashed bg-zinc-50/50 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <p className="text-sm text-zinc-500">No domain aliases yet.</p>
          <p className="mt-1 text-xs text-zinc-400">
            Add a parent-group domain so manager mail attaches to this venue automatically.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {aliases.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 font-medium text-sm">
                  <AtSign className="h-3 w-3 shrink-0 text-zinc-400" />
                  <span className="truncate">{a.domain}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Added {a.createdAtLabel}
                  {a.createdByName ? ` by ${a.createdByName}` : ""}
                  {a.notes ? ` -- ${a.notes}` : ""}
                </p>
              </div>
              <RemoveAliasButton
                aliasId={a.id}
                venueId={venueId}
                domain={a.domain}
                removeAction={removeAction}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RemoveAliasButton({
  aliasId,
  venueId,
  domain,
  removeAction,
}: {
  aliasId: string;
  venueId: string;
  domain: string;
  removeAction: RemoveAction;
}) {
  const [state, doRemove, removing] = useActionState(removeAction, null);
  return (
    <form action={doRemove} className="shrink-0">
      <input type="hidden" name="aliasId" value={aliasId} />
      <input type="hidden" name="venueId" value={venueId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={removing}
        aria-label={`Remove ${domain}`}
        title={state && !state.ok && state.error ? state.error : `Remove ${domain}`}
        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
      >
        {removing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </form>
  );
}
