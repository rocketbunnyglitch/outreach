"use client";

/**
 * Snippets admin manager (Tier-2). Create / edit / delete team snippets.
 * Display + management only; nothing here touches the send path.
 */

import { useToast } from "@/components/ui/toast";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type SnippetRow, createSnippet, deleteSnippet, updateSnippet } from "../_actions";

interface DraftForm {
  trigger: string;
  label: string;
  body: string;
}

const EMPTY: DraftForm = { trigger: "", label: "", body: "" };

export function SnippetsManager({ initial }: { initial: SnippetRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();
  // null = not editing; "new" = adding; a uuid = editing that row.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm>(EMPTY);

  function startAdd() {
    setForm(EMPTY);
    setEditing("new");
  }
  function startEdit(row: SnippetRow) {
    setForm({ trigger: row.trigger, label: row.label, body: row.body });
    setEditing(row.id);
  }
  function cancel() {
    setEditing(null);
    setForm(EMPTY);
  }

  function save() {
    const payload = { trigger: form.trigger.trim(), label: form.label.trim(), body: form.body };
    startTx(async () => {
      const res =
        editing === "new"
          ? await createSnippet(payload)
          : await updateSnippet(editing as string, payload);
      if (res.ok) {
        toast.show({
          kind: "success",
          message: editing === "new" ? "Snippet created." : "Snippet saved.",
        });
        cancel();
        router.refresh();
      } else {
        toast.show({ kind: "error", message: res.error ?? "Couldn't save the snippet." });
      }
    });
  }

  function remove(row: SnippetRow) {
    if (!confirm(`Delete the ";${row.trigger}" snippet?`)) return;
    startTx(async () => {
      const res = await deleteSnippet(row.id);
      if (res.ok) {
        toast.show({ kind: "success", message: "Snippet deleted." });
        if (editing === row.id) cancel();
        router.refresh();
      } else {
        toast.show({ kind: "error", message: res.error ?? "Couldn't delete the snippet." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-500">
          {initial.length} snippet{initial.length === 1 ? "" : "s"}
        </span>
        {editing !== "new" && (
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <Plus className="h-3.5 w-3.5" /> New snippet
          </button>
        )}
      </div>

      {editing === "new" && (
        <SnippetForm
          form={form}
          setForm={setForm}
          onSave={save}
          onCancel={cancel}
          pending={pending}
        />
      )}

      <div className="flex flex-col gap-2">
        {initial.length === 0 && editing !== "new" ? (
          <p className="rounded-xl border border-zinc-200 border-dashed px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
            No snippets yet. Create one to start using <code>;triggers</code> in the composer.
          </p>
        ) : null}
        {initial.map((row) =>
          editing === row.id ? (
            <SnippetForm
              key={row.id}
              form={form}
              setForm={setForm}
              onSave={save}
              onCancel={cancel}
              pending={pending}
            />
          ) : (
            <div
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-xs dark:bg-zinc-800">
                    ;{row.trigger}
                  </code>
                  <span className="truncate font-medium text-sm">{row.label}</span>
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-zinc-500">
                  {row.body}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  disabled={pending}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(row)}
                  disabled={pending}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function SnippetForm({
  form,
  setForm,
  onSave,
  onCancel,
  pending,
}: {
  form: DraftForm;
  setForm: (f: DraftForm) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-zinc-500">Trigger (typed as ;trigger)</span>
          <div className="flex items-center gap-1">
            <span className="text-zinc-400">;</span>
            <input
              value={form.trigger}
              onChange={(e) => setForm({ ...form, trigger: e.target.value })}
              placeholder="intro"
              className="w-32 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="text-zinc-500">Label</span>
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Intro blurb"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-zinc-500">
          Body (merge fields like {"{{venue_name}}"} are allowed)
        </span>
        <textarea
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={4}
          placeholder="Hi {{contact_first_name}}, thanks for getting back to me..."
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !form.trigger.trim() || !form.label.trim() || !form.body.trim()}
          className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white text-xs hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
