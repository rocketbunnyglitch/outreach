"use server";

/**
 * Lightweight server action used by the venue create form to surface
 * possible duplicates as the operator types.
 *
 * Returns at most 5 matches above the similarity threshold. Empty list
 * is the happy path — no warning shown.
 *
 * Not audit-logged: this is a read-only diagnostic, no mutation.
 */

import { requireStaff } from "@/lib/auth";
import { type VenueDuplicate, findVenueDuplicates } from "@/lib/venue-duplicates";

export async function checkVenueDuplicates(opts: {
  candidateName: string;
  candidateAddress?: string | null;
  cityId?: string | null;
}): Promise<VenueDuplicate[]> {
  await requireStaff();
  return findVenueDuplicates({
    candidateName: opts.candidateName,
    candidateAddress: opts.candidateAddress ?? null,
    cityId: opts.cityId ?? null,
    threshold: 0.4,
    limit: 5,
  });
}
