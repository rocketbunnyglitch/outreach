/**
 * Send-intent classification (P0).
 *
 * Every venue / host / internal email send is classified BEFORE the
 * cold-send cap, the cadence floor, the cold-cadence seed, and the
 * cadence-touch logging run -- so that lifecycle / cancellation /
 * post-event / host / custom sends can never be mistaken for cold
 * outreach and corrupt the cadence state or consume the cold-send
 * budget.
 *
 * Pure + dependency-free (no db, no "server-only") so it is unit-tested
 * directly and safe to import from any layer.
 *
 * Core rules:
 *   - Engine drafts, humans send.
 *   - Every send has an explicit intent. Nothing is GUESSED as cold
 *     cadence. A send with no template/touch and no reply context is
 *     "unknown": it never seeds cold cadence and never records a
 *     cadence touch. (It still counts against the per-inbox cold cap
 *     for deliverability -- a brand-new venue email IS a cold contact
 *     -- but it is never written as a structured cold_touch_1.)
 *
 * The classifier keys off the real Halloween-2026 template_code /
 * touch_type vocabulary (verified against prod email_templates):
 *   cold openers/details : T1 T2 T3 T4 T5 T6 T7A T7B T8
 *   lifecycle            : T9 T9-far T9-near T10 T11 T11-* T13 T13W T14 T15  V1
 *   cancellation         : T16
 *   post-event           : T17
 *   host                 : H0a H0b
 * Keep this in sync with scripts/seed-halloween-2026-templates.ts and
 * lib/reference-docs/halloween-2026-intl-engine-reference.md.
 */

export type SendIntent =
  | "cold_cadence"
  | "warm_cadence"
  | "lifecycle"
  | "cancellation"
  | "post_event"
  | "custom_reply"
  | "host"
  | "internal"
  | "system"
  | "unknown";

export type SendRecipientType = "venue" | "host" | "internal" | "system";

export interface SendIntentResult {
  sendIntent: SendIntent;
  /** Participates in the cold/warm cadence machine. */
  cadenceManaged: boolean;
  /** Consumes the per-inbox daily cold-send budget. */
  countsAgainstColdCap: boolean;
  /** Subject to the cadence floor (hard cap + cross-domain spacing). */
  appliesCadenceFloor: boolean;
  /** Records a venue_campaign_touch_log cadence touch + advances state. */
  recordsCadenceTouch: boolean;
  /** Seeds cold_pending_touch_1 on a brand-new thread. */
  seedsColdCadence: boolean;
  /**
   * Force the send to be treated as 'operational' for the cap: it never
   * eats the cold budget regardless of cold/warm category, the cold-cap
   * block + cooldown are skipped, and recordSendEvent stores
   * send_type='operational'.
   */
  operationalForCap: boolean;
  recipientType: SendRecipientType;
  /** Human-readable rationale for logs / debugging. */
  reason: string;
}

export interface DeriveSendIntentInput {
  /** email_templates.template_code resolved from the draft's templateId. */
  templateCode?: string | null;
  /** email_drafts.touch_type (T-code / category). Preferred over templateCode. */
  touchType?: string | null;
  /** email_drafts.recipient_type. */
  recipientType?: SendRecipientType | null;
  /** Is this a reply to an existing thread? (replyToThreadId present) */
  isReply?: boolean;
  /** Cold/warm from classifySend (the reply thread's inbound history). */
  cadenceCategory?: "cold" | "warm" | null;
  /**
   * Explicit signal that a slot-detail send (T4/T5/T6) was triggered by a call
   * outcome ("send me the slots") rather than a cold sequence. Such a send is
   * operational: it bypasses the cadence floor and never counts as cold.
   * Only affects T4/T5/T6 -- ignored for every other family. (P0-2)
   */
  slotDetailFromCallOutcome?: boolean;
}

// Family token sets. codeFamily() collapses "T9-near" -> "T9",
// "T7A" -> "T7", "T11-wristband" -> "T11", "T13W" -> "T13", "H0a" -> "H".
const COLD_FAMILIES = new Set(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]);
// Slot-detail templates. Unlike the true cold openers (T1-T3, T7, T8), these
// are routinely RE-USED after engagement -- sent into a warm reply thread, or
// off a phone call where the venue said "send me the slots". In those contexts
// they must NOT consume the cold cap or seed cold cadence. (P0-2)
const SLOT_DETAIL_FAMILIES = new Set(["T4", "T5", "T6"]);
const LIFECYCLE_FAMILIES = new Set(["T9", "T10", "T11", "T12", "T13", "T14", "T15"]);
const CANCELLATION_FAMILIES = new Set(["T16"]);
const POST_EVENT_FAMILIES = new Set(["T17"]);
// V1 = internal-host venue confirmation: operational venue mail, no cadence.
const OPERATIONAL_VENUE_FAMILIES = new Set(["V"]);

/**
 * Collapse a touch/template code to its leading family token.
 *   T1 -> "T1", "T9-near" -> "T9", "T7A" -> "T7", "T11-wristband" -> "T11",
 *   "T13W" -> "T13", "H0a" -> "H", "V1" -> "V".
 * Returns "" when the input has no recognizable leading token.
 */
export function codeFamily(raw: string): string {
  const s = raw.trim().toUpperCase();
  const t = s.match(/^T(\d+)/);
  if (t) return `T${t[1]}`;
  if (/^H\d/.test(s) || s === "H") return "H";
  if (/^V\d/.test(s) || s === "V") return "V";
  return s;
}

function result(
  sendIntent: SendIntent,
  recipientType: SendRecipientType,
  reason: string,
): SendIntentResult {
  const base = {
    sendIntent,
    recipientType,
    reason,
    cadenceManaged: false,
    countsAgainstColdCap: false,
    appliesCadenceFloor: false,
    recordsCadenceTouch: false,
    seedsColdCadence: false,
    operationalForCap: false,
  };
  switch (sendIntent) {
    case "cold_cadence":
      return {
        ...base,
        cadenceManaged: true,
        countsAgainstColdCap: true,
        appliesCadenceFloor: true,
        recordsCadenceTouch: true,
        seedsColdCadence: true,
      };
    case "warm_cadence":
      return {
        ...base,
        cadenceManaged: true,
        appliesCadenceFloor: true,
        recordsCadenceTouch: true,
      };
    case "lifecycle":
    case "cancellation":
    case "post_event":
    case "host":
    case "internal":
    case "system":
      // Operational families: never cadence, never cold cap.
      return { ...base, operationalForCap: true };
    case "custom_reply":
      // Operator-written / operational reply on an engaged thread: no cadence
      // side effects, never cold, and operational-for-cap so it is never
      // cap-blocked or cooldown-blocked (the venue is already engaged). Used
      // for slot-detail (T4/T5/T6) sends triggered by a call outcome.
      return { ...base, operationalForCap: true };
    case "unknown":
      // New venue thread with no template/touch. Do NOT fabricate cold
      // cadence, but still pace it against the cold cap (deliverability).
      return { ...base, countsAgainstColdCap: true };
  }
}

/**
 * Classify a send. Explicit non-cadence template/touch families win over
 * any reply heuristic; cold/warm cadence is derived from the template
 * family, then from reply context; everything else is "unknown".
 */
export function deriveSendIntent(input: DeriveSendIntentInput): SendIntentResult {
  const recipientType = input.recipientType ?? "venue";
  const codeRaw = (input.touchType ?? input.templateCode ?? "").trim();
  const fam = codeRaw ? codeFamily(codeRaw) : "";

  // 1. Explicit operational / lifecycle families win regardless of reply.
  if (CANCELLATION_FAMILIES.has(fam)) {
    return result("cancellation", recipientType, `cancellation touch ${fam}`);
  }
  if (POST_EVENT_FAMILIES.has(fam)) {
    return result("post_event", recipientType, `post-event touch ${fam}`);
  }
  if (LIFECYCLE_FAMILIES.has(fam) || OPERATIONAL_VENUE_FAMILIES.has(fam)) {
    return result("lifecycle", recipientType, `lifecycle/operational touch ${fam}`);
  }
  if (fam === "H" || recipientType === "host") {
    return result("host", "host", `host touch ${fam || "(recipient=host)"}`);
  }
  if (recipientType === "internal") return result("internal", "internal", "internal recipient");
  if (recipientType === "system") return result("system", "system", "system recipient");

  // 2. Cold cadence opener/detail (template-driven). T3 is a warm-copy
  //    re-engagement opener but in cadence terms it is a first touch that
  //    initiates the sequence, so it behaves like a cold opener.
  if (COLD_FAMILIES.has(fam)) {
    // Slot-detail (T4/T5/T6) are context-sensitive (P0-2). The SAME template
    // is a cold touch when it opens/continues a cold sequence, but operational
    // when sent in response to engagement. Other cold families (T1-T3, T7, T8)
    // are true sequence touches and stay cold even as a follow-up.
    if (SLOT_DETAIL_FAMILIES.has(fam)) {
      if (input.slotDetailFromCallOutcome) {
        // Venue asked for slots on a call -> operational: bypass the cadence
        // floor, never count as cold, never cap-block.
        return result(
          "custom_reply",
          recipientType,
          `slot-detail ${fam} from a call outcome (operational, bypasses floor)`,
        );
      }
      if (input.isReply && input.cadenceCategory === "warm") {
        // Slot detail sent into an engaged (has-inbound) warm thread: warm
        // cadence, not cold -- no cold cap, no cold seed.
        return result(
          "warm_cadence",
          recipientType,
          `slot-detail ${fam} on an engaged (warm) thread`,
        );
      }
    }
    return result("cold_cadence", recipientType, `cold cadence touch ${fam}`);
  }

  // 3. No explicit template/touch -- fall back to reply context.
  if (input.isReply) {
    if (input.cadenceCategory === "warm") {
      // Reply on an engaged (has-inbound) thread. Treated as warm cadence:
      // the thread's own cadence_state decides whether a warm_nudge touch
      // is actually recorded (the send pipeline re-checks planFromState).
      return result("warm_cadence", recipientType, "reply on an engaged (warm) thread");
    }
    // Reply on an outbound-only thread (no inbound yet) = cold follow-up.
    return result("cold_cadence", recipientType, "follow-up on a cold (no-reply) thread");
  }

  // 4. New venue thread, no template/touch: genuinely ambiguous.
  return result(
    "unknown",
    recipientType,
    "new venue thread with no template/touch -- not recorded as cold cadence",
  );
}
