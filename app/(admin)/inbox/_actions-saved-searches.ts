"use server";

/**
 * Saved-search server actions (Phase B.2).
 *
 * Thin wrappers around the lib/inbox-saved-searches helpers so
 * client components can fire them via use-transition.
 */

import {
  createSavedSearch as _create,
  deleteSavedSearch as _delete,
  renameSavedSearch as _rename,
} from "@/lib/inbox-saved-searches";

export async function createSavedSearchAction(input: {
  label: string;
  queryText: string;
}) {
  return _create(input);
}

export async function renameSavedSearchAction(input: { id: string; label: string }) {
  return _rename(input);
}

export async function deleteSavedSearchAction(input: { id: string }) {
  return _delete(input);
}
