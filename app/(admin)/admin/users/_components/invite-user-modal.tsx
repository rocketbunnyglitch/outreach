"use client";

import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { Loader2, X } from "lucide-react";
import { type ReactNode, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { inviteUser } from "../_actions";

type Mode = "set_now" | "send_link";

/**
 * Wraps a trigger element. Click opens a centered modal portaled to
 * <body> so it escapes any parent overflow-hidden. Same pattern as
 * the warm-lead promote modal.
 */
export function InviteUserModal({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("send_link");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ inviteLinkPath?: string } | null>(null);
  const [isPending, startTx] = useTransition();

  function close() {
    setOpen(false);
    setError(null);
    setSuccess(null);
    setMode("send_link");
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    formData.set("mode", mode);
    startTx(async () => {
      const result = await inviteUser(null, formData);
      if (result.ok) {
        setSuccess({ inviteLinkPath: result.data.inviteLinkPath });
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex">
        {children}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 px-4 pt-[10vh] pb-10 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          >
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
                    New user
                  </p>
                  <h2 className="mt-1 font-semibold text-lg tracking-tight">Invite a user</h2>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {success ? (
                <div className="flex flex-col gap-3">
                  <p className="text-emerald-700 text-sm dark:text-emerald-400">User created.</p>
                  {success.inviteLinkPath && (
                    <div className="flex flex-col gap-1 rounded-md bg-blue-50 px-3 py-2 text-blue-900 text-xs dark:bg-blue-950/40 dark:text-blue-200">
                      <span>Send them this link (one-time use, expires in 7 days):</span>
                      <code className="break-all font-mono text-[11px]">
                        {success.inviteLinkPath}
                      </code>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={close}
                    className="self-end rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <form action={handleSubmit} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="font-medium text-xs">Display name</span>
                    <input
                      name="displayName"
                      required
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-medium text-xs">Email</span>
                    <input
                      name="email"
                      type="email"
                      required
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-medium text-xs">Role</span>
                    <select
                      name="role"
                      defaultValue="outreach"
                      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="admin">Admin</option>
                      <option value="lead">Lead</option>
                      <option value="outreach">Outreach</option>
                      <option value="readonly">Read-only</option>
                    </select>
                  </label>

                  <fieldset className="mt-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                    <legend className="px-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
                      How to set their password
                    </legend>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name="modeRadio"
                          checked={mode === "send_link"}
                          onChange={() => setMode("send_link")}
                          className="mt-0.5"
                        />
                        <span>
                          <strong>Send invite link</strong> — generates a one-time URL you share
                          with them; they pick their own password.
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name="modeRadio"
                          checked={mode === "set_now"}
                          onChange={() => setMode("set_now")}
                          className="mt-0.5"
                        />
                        <span>
                          <strong>Set a password now</strong> — enter it below and tell them
                          out-of-band.
                        </span>
                      </label>
                    </div>
                    {mode === "set_now" && (
                      <label className="mt-3 flex flex-col gap-1">
                        <span className="font-medium text-xs">
                          Password (min {MIN_PASSWORD_LENGTH} chars)
                        </span>
                        <input
                          name="password"
                          type="password"
                          minLength={MIN_PASSWORD_LENGTH}
                          required={mode === "set_now"}
                          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      </label>
                    )}
                  </fieldset>

                  {error && (
                    <div className="rounded-md bg-rose-50 px-3 py-2 text-rose-700 text-xs dark:bg-rose-950/40 dark:text-rose-300">
                      {error}
                    </div>
                  )}

                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-50 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Create user
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
