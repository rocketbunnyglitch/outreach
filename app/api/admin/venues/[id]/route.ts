/**
 * PATCH /api/admin/venues/[id]
 *
 * Operator-driven venue correction endpoint, designed for the
 * Claude-in-Chrome verify loop after the Halloween 2025 import.
 *
 * Claude Code runs Claude in Chrome over the review-queue
 * markdown, opens each venue's Google Maps URL, reads the
 * canonical name + formatted address, and PATCHes them back
 * here.
 *
 * Body:
 *   {
 *     "name":               string?    — canonical venue name
 *     "address":            string?    — canonical formatted address
 *     "verifiedFromGoogle": boolean    — flag for audit
 *   }
 *
 * Auth: admin-only via requireAdmin. The operator's Chrome
 * session ships its cookie with each request — same auth path
 * as the admin UI.
 *
 * Source-of-truth rule: when the body's name or address differs
 * from the existing venue, we DO overwrite — but ONLY because
 * this endpoint is the explicit "operator-verified-from-Google"
 * channel. Other backfill paths still respect manual edits.
 *
 * Idempotent: repeated PATCH with the same body produces the
 * same final state.
 *
 * Errors are wrapped via the operator-error system (lib/op-error)
 * so failures produce a code Claude Code can paste back to the
 * operator for diagnosis.
 */

import { venues } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { newOpError } from "@/lib/op-error";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().max(500).optional(),
  verifiedFromGoogle: z.boolean().optional(),
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await ctx.params;
  if (!uuidPattern.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid venue id." }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const op = newOpError("api.admin.venues.patch");

  try {
    // Need at least one updatable field to do anything.
    if (parsed.data.name === undefined && parsed.data.address === undefined) {
      return NextResponse.json({
        ok: true,
        data: { id, changed: false, fields: [] },
      });
    }

    const existing = await db
      .select({ name: venues.name, address: venues.address })
      .from(venues)
      .where(eq(venues.id, id))
      .limit(1)
      .then((r) => r[0]);

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Venue not found.", code: op.code },
        { status: 404 },
      );
    }

    // Build the update object from only the fields that actually
    // changed. Avoids the `delete` operator (biome smell) and the
    // case where a no-op PATCH bumps the updated_at timestamp.
    const cleanUpdates: Record<string, unknown> = {};
    const changedFields: string[] = [];

    if (parsed.data.name !== undefined && parsed.data.name !== existing.name) {
      cleanUpdates.name = parsed.data.name;
      changedFields.push("name");
    }
    const addressNorm = parsed.data.address ? parsed.data.address : null;
    if (parsed.data.address !== undefined && addressNorm !== existing.address) {
      cleanUpdates.address = addressNorm;
      changedFields.push("address");
    }

    if (changedFields.length === 0) {
      return NextResponse.json({
        ok: true,
        data: { id, changed: false, fields: [] },
      });
    }

    await db.update(venues).set(cleanUpdates).where(eq(venues.id, id));

    logger.info(
      {
        venueId: id,
        fields: changedFields,
        verifiedFromGoogle: parsed.data.verifiedFromGoogle ?? false,
      },
      "venue verified via PATCH",
    );

    return NextResponse.json({
      ok: true,
      data: { id, changed: true, fields: changedFields },
    });
  } catch (err) {
    op.log(err, { venueId: id });
    return NextResponse.json(
      { ok: false, error: "Couldn't update venue.", code: op.code },
      { status: 500 },
    );
  }
}
