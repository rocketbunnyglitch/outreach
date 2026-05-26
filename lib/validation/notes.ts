/**
 * Notes validation.
 *
 * Notes are polymorphic — they attach to a venue, city_campaign, or
 * campaign. Author is the current staff member (server-derived, not
 * user-supplied). The body is plain text; future iterations can add
 * @mention parsing.
 *
 * No version column — notes are short-lived and rarely concurrent-edited.
 * Soft-delete via the auditColumns archived_at field.
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

export const noteTargetTypeEnum = z.enum(["city_campaign", "venue", "campaign"]);

export const noteCreateSchema = z.object({
  targetType: noteTargetTypeEnum,
  targetId: uuidSchema,
  body: z.string().trim().min(1, "Required").max(8000),
});
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;

export const noteDeleteSchema = z.object({
  id: uuidSchema,
});
export type NoteDeleteInput = z.infer<typeof noteDeleteSchema>;

/**
 * Extract @-mention handles from a note body. Returns the lowercased
 * handles (no @ prefix). Matches Twitter-style handles: `@name` where
 * `name` is alphanumeric + underscore + period, 1-30 chars.
 *
 * The handles aren't UUIDs — they're staff display-name slugs. The
 * server action resolves them to staff_member rows via a lookup table.
 *
 * Example: extractMentions("hey @bryle and @jc check this") → ["bryle", "jc"]
 */
export function extractMentions(body: string): string[] {
  const matches = body.match(/@[a-zA-Z0-9_.]{1,30}/g) ?? [];
  // Dedupe + lowercase + strip @
  return Array.from(new Set(matches.map((m) => m.slice(1).toLowerCase())));
}
