/**
 * Validation for outreach log entries.
 *
 * Outreach log is append-only. Each entry records a single touchpoint
 * (email, call, in-person visit, etc) toward a venue, with an outcome.
 * In Phase 6 this becomes the source of truth for automated cadences;
 * in Phase 4b we just let staff log them manually so the history is
 * captured.
 */

import { z } from "zod";

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a valid UUID");

export const outreachChannelSchema = z.enum([
  "email",
  "call",
  "sms",
  "instagram",
  "form",
  "in_person",
]);

export const outreachOutcomeSchema = z.enum([
  "sent",
  "bad_email",
  "bounced",
  "no_answer",
  "voicemail",
  "callback_requested",
  "declined",
  "interested",
  "confirmed",
  "wrong_number",
]);

export const outreachLogCreateSchema = z.object({
  venueId: uuidSchema,
  outreachBrandId: uuidSchema,
  channel: outreachChannelSchema,
  outcome: outreachOutcomeSchema,
  subject: z.union([z.literal("").transform(() => undefined), z.string().max(500)]).optional(),
  notes: z.union([z.literal("").transform(() => undefined), z.string().max(5000)]).optional(),
});

export type OutreachLogCreateInput = z.infer<typeof outreachLogCreateSchema>;
