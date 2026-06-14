/**
 * Decision confidence — how sure the engine is about a draft it produced.
 *
 * Phase A of the autonomy roadmap: you cannot grant autonomy you can't measure.
 * Every engine-authored draft gets a 0-100 confidence score from a few honest
 * signals, recorded in the shadow ledger alongside what the human actually did.
 * High score + high human-agreement over time = the evidence to let that touch
 * class auto-send (Phase D). Low score always routes to a human.
 *
 * Pure + dependency-free so it's testable and reusable on any draft path.
 */

export interface ConfidenceInputs {
  /** Recipient deliverability: 1 = ZeroBounce valid, 0.5 = unknown/catch-all,
   *  0 = invalid / do-not-mail. */
  recipientValidity: number;
  /** 1 = the engine picked a specific template for this stage; 0.4 = it fell
   *  back to a generic default (less sure the copy fits). */
  templateConfidence: number;
  /** 1 = the cadence/lifecycle state is unambiguous; 0.5 = the state was
   *  inferred or borderline. */
  cadenceClarity: number;
  /** For reply drafts: the classifier's confidence in the thread's intent
   *  (0-1). Omit for cold/lifecycle touches (treated as 1 — no ambiguity). */
  classificationConfidence?: number;
  /** false = a send-safety / guardrail flag is present (wrong account,
   *  relationship block, suppression, values violation). Hard-caps the score. */
  safetyClear: boolean;
}

export interface ConfidenceResult {
  score: number; // 0-100
  factors: Record<string, number>;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Composite confidence. A safety flag hard-caps the score low (you never
 * auto-act on something the safety layer flagged, regardless of other signals).
 * Otherwise a weighted blend of the deliverability, template-fit, cadence, and
 * (for replies) classification signals.
 */
export function scoreDecision(input: ConfidenceInputs): ConfidenceResult {
  const recipient = clamp01(input.recipientValidity);
  const template = clamp01(input.templateConfidence);
  const cadence = clamp01(input.cadenceClarity);
  const classification = clamp01(input.classificationConfidence ?? 1);

  const factors = {
    recipientValidity: recipient,
    templateConfidence: template,
    cadenceClarity: cadence,
    classificationConfidence: classification,
    safetyClear: input.safetyClear ? 1 : 0,
  };

  if (!input.safetyClear) {
    return { score: Math.min(15, Math.round(recipient * 15)), factors };
  }

  const blended = 0.35 * recipient + 0.25 * template + 0.2 * cadence + 0.2 * classification;
  return { score: Math.round(clamp01(blended) * 100), factors };
}

/** Map a ZeroBounce status string to the recipientValidity signal. */
export function recipientValidityFromZb(zbStatus: string | null | undefined): number {
  switch ((zbStatus ?? "").toLowerCase()) {
    case "valid":
      return 1;
    case "catch-all":
    case "catch_all":
    case "unknown":
    case "":
      return 0.5;
    default:
      // invalid, do_not_mail, spamtrap, abuse, etc.
      return 0;
  }
}

/** Confidence tiers for routing + display. */
export type ConfidenceTier = "high" | "medium" | "low";
export function confidenceTier(score: number): ConfidenceTier {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}
