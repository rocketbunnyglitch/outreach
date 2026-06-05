"use client";

/**
 * CampaignInfoTable — the inbox catalogue with owner + campaign
 * assignment per row.
 *
 * Two render modes:
 *   admin     -> owner dropdown + assigned checkbox
 *   non-admin -> static text + "Assigned" emerald chip / "—" placeholder
 *
 * Both modes use optimistic state: clicking a control flips the local
 * value immediately. If the server returns an error we revert and
 * surface the message inline.
 */

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { CheckCircle2, Circle, Loader2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { syncProfilePhotoFromGmail } from "../../settings/inboxes/_actions";
import { SignatureEditor } from "../../settings/inboxes/_components/signature-editor";
import {
  setInboxAlias,
  setInboxBrand,
  setInboxCampaignAssignment,
  setInboxOwner,
} from "../_actions";

interface InboxRow {
  id: string;
  emailAddress: string;
  status: "connected" | "needs_reauth" | "disconnected";
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  assignedToCampaign: boolean;
  outreachBrandId: string | null;
  outreachBrandName: string | null;
  aliasName: string | null;
  signatureHtml: string | null;
  googleDisplayName: string | null;
  avatarUrl: string | null;
}

interface TeamMember {
  id: string;
  displayName: string;
  role: string;
}

interface BrandOption {
  id: string;
  displayName: string;
}

export function CampaignInfoTable({
  inboxes: initial,
  teamMembers,
  brands,
  campaignId,
  isAdmin,
}: {
  inboxes: InboxRow[];
  teamMembers: TeamMember[];
  brands: BrandOption[];
  campaignId: string;
  isAdmin: boolean;
}) {
  const [rows, setRows] = useState<InboxRow[]>(initial);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="card-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
            <th className="px-4 py-2.5">Inbox</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Owner</th>
            <th className="px-4 py-2.5">Assigned to campaign</th>
            <th className="px-4 py-2.5">Brand (company name)</th>
            <th className="px-4 py-2.5">Alias (sender name)</th>
            <th className="px-4 py-2.5">Signature</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row
              key={r.id}
              row={r}
              teamMembers={teamMembers}
              brands={brands}
              campaignId={campaignId}
              isAdmin={isAdmin}
              onUpdate={(next) => {
                setRows((prev) => prev.map((x) => (x.id === next.id ? next : x)));
                setError(null);
              }}
              onError={setError}
            />
          ))}
        </tbody>
      </table>
      {error && (
        <div className="border-rose-200 border-t bg-rose-50 px-4 py-2 text-rose-700 text-xs dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
    </section>
  );
}

function Row({
  row,
  teamMembers,
  brands,
  campaignId,
  isAdmin,
  onUpdate,
  onError,
}: {
  row: InboxRow;
  teamMembers: TeamMember[];
  brands: BrandOption[];
  campaignId: string;
  isAdmin: boolean;
  onUpdate: (next: InboxRow) => void;
  onError: (msg: string | null) => void;
}) {
  const [isPending, startTx] = useTransition();
  const toast = useToast();

  function syncPhoto() {
    startTx(async () => {
      const res = await syncProfilePhotoFromGmail(row.id);
      if (!res.ok) {
        toast.show({ kind: "error", message: res.error ?? "Couldn't sync photo." });
        return;
      }
      onUpdate({ ...row, avatarUrl: res.data.avatarUrl });
      toast.show({ kind: "success", message: "Profile picture synced from Gmail." });
    });
  }

  function changeOwner(ownerUserId: string) {
    const previous = row;
    const next = {
      ...row,
      ownerUserId: ownerUserId || null,
      ownerDisplayName: ownerUserId
        ? (teamMembers.find((m) => m.id === ownerUserId)?.displayName ?? null)
        : null,
    };
    onUpdate(next);
    startTx(async () => {
      const fd = new FormData();
      fd.set("inboxId", row.id);
      fd.set("ownerUserId", ownerUserId);
      const result = await setInboxOwner(null, fd);
      if (!result.ok) {
        onUpdate(previous);
        onError(result.error);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't change owner.",
          code: result.code,
        });
      }
    });
  }

  function toggleAssignment() {
    const previous = row;
    const nextAssigned = !row.assignedToCampaign;
    onUpdate({ ...row, assignedToCampaign: nextAssigned });
    startTx(async () => {
      const fd = new FormData();
      fd.set("inboxId", row.id);
      fd.set("campaignId", campaignId);
      fd.set("assign", nextAssigned ? "1" : "0");
      const result = await setInboxCampaignAssignment(null, fd);
      if (!result.ok) {
        onUpdate(previous);
        onError(result.error);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't change assignment.",
          code: result.code,
        });
      }
    });
  }

  function changeBrand(brandId: string) {
    const previous = row;
    // Picking a brand also assigns the inbox to the campaign (the upsert
    // creates the row), so reflect that optimistically.
    const next: InboxRow = {
      ...row,
      outreachBrandId: brandId || null,
      outreachBrandName: brandId
        ? (brands.find((b) => b.id === brandId)?.displayName ?? null)
        : null,
      assignedToCampaign: brandId ? true : row.assignedToCampaign,
    };
    onUpdate(next);
    startTx(async () => {
      const fd = new FormData();
      fd.set("inboxId", row.id);
      fd.set("campaignId", campaignId);
      fd.set("outreachBrandId", brandId);
      const result = await setInboxBrand(null, fd);
      if (!result.ok) {
        onUpdate(previous);
        onError(result.error);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't change brand.",
          code: result.code,
        });
      }
    });
  }

  function saveAlias(aliasName: string) {
    const trimmed = aliasName.trim();
    if (trimmed === (row.aliasName ?? "")) return; // no change
    const previous = row;
    onUpdate({ ...row, aliasName: trimmed || null, assignedToCampaign: true });
    startTx(async () => {
      const fd = new FormData();
      fd.set("inboxId", row.id);
      fd.set("campaignId", campaignId);
      fd.set("aliasName", trimmed);
      const result = await setInboxAlias(null, fd);
      if (!result.ok) {
        onUpdate(previous);
        onError(result.error);
        toast.show({
          kind: "error",
          message: result.error ?? "Couldn't change alias.",
          code: result.code,
        });
      }
    });
  }

  return (
    <tr>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          {row.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-6 w-6 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 font-medium text-[10px] text-zinc-600 uppercase dark:bg-zinc-700 dark:text-zinc-300">
              {(row.googleDisplayName ?? row.emailAddress).charAt(0)}
            </span>
          )}
          <span className="font-mono text-xs">{row.emailAddress}</span>
          <button
            type="button"
            onClick={syncPhoto}
            disabled={isPending}
            title="Sync profile picture from Gmail"
            aria-label={`Sync profile picture for ${row.emailAddress}`}
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={cn("h-3 w-3", isPending && "animate-spin")} />
          </button>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-widest",
            row.status === "connected" && "text-emerald-600 dark:text-emerald-400",
            row.status === "needs_reauth" && "text-amber-600 dark:text-amber-400",
            row.status === "disconnected" && "text-zinc-500",
          )}
        >
          {row.status.replace("_", " ")}
        </span>
      </td>
      <td className="px-4 py-2.5">
        {isAdmin ? (
          <select
            value={row.ownerUserId ?? ""}
            onChange={(e) => changeOwner(e.target.value)}
            disabled={isPending}
            aria-label={`Owner for ${row.emailAddress}`}
            className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {/* Owner is required at the schema level. Pre-existing
                rows always have one; new connects pick one. The
                select intentionally has no "Unassigned" option. */}
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.role})
              </option>
            ))}
          </select>
        ) : row.ownerDisplayName ? (
          <span className="text-sm">{row.ownerDisplayName}</span>
        ) : (
          <span className="text-xs text-zinc-500">— Unassigned —</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <button
              type="button"
              onClick={toggleAssignment}
              disabled={isPending}
              aria-pressed={row.assignedToCampaign}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors",
                row.assignedToCampaign
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800",
              )}
            >
              {row.assignedToCampaign ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Assigned
                </>
              ) : (
                <>
                  <Circle className="h-3.5 w-3.5" />
                  Not assigned
                </>
              )}
            </button>
          ) : row.assignedToCampaign ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-800 text-xs dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Assigned
            </span>
          ) : (
            <span className="text-xs text-zinc-500">—</span>
          )}
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
        </div>
      </td>
      <td className="px-4 py-2.5">
        {isAdmin ? (
          <select
            value={row.outreachBrandId ?? ""}
            onChange={(e) => changeBrand(e.target.value)}
            disabled={isPending}
            aria-label={`Brand for ${row.emailAddress}`}
            className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Template default</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName}
              </option>
            ))}
          </select>
        ) : row.outreachBrandName ? (
          <span className="text-sm">{row.outreachBrandName}</span>
        ) : (
          <span className="text-xs text-zinc-500">Template default</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {isAdmin ? (
          <div className="flex flex-col items-start gap-1">
            <input
              // Re-mount when the saved alias changes (e.g. after "Use Google
              // name") so the uncommitted defaultValue reflects the new value.
              key={row.aliasName ?? "empty"}
              type="text"
              defaultValue={row.aliasName ?? ""}
              onBlur={(e) => saveAlias(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              disabled={isPending}
              placeholder={row.googleDisplayName ?? "Sender's name"}
              aria-label={`Sender alias for ${row.emailAddress}`}
              className="w-36 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {!row.aliasName && row.googleDisplayName && (
              <button
                type="button"
                onClick={() => saveAlias(row.googleDisplayName ?? "")}
                disabled={isPending}
                title="Use the Google account name as the sender name"
                className="font-mono text-[10px] text-blue-600 uppercase tracking-[0.06em] hover:underline disabled:opacity-50 dark:text-blue-400"
              >
                Use "{row.googleDisplayName}"
              </button>
            )}
          </div>
        ) : row.aliasName ? (
          <span className="text-sm">{row.aliasName}</span>
        ) : row.googleDisplayName ? (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">{row.googleDisplayName}</span>
        ) : (
          <span className="text-xs text-zinc-500">User's name</span>
        )}
      </td>
      <td className="px-4 py-2.5 align-top">
        <SignatureEditor connectedAccountId={row.id} initialSignatureHtml={row.signatureHtml} />
      </td>
    </tr>
  );
}
