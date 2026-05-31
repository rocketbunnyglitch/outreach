/**
 * Shared form helpers used by every server action.
 *
 * `formToObject` turns a FormData into a plain object the Zod schemas can
 * safe-parse. Conventions:
 *   - empty string ""        → undefined  (so .optional() applies)
 *   - "_none" sentinel       → null       (so nullable FKs can be cleared)
 *   - "true" / "on"          → true       (browser checkbox checked)
 *   - "false" / "off"        → false      (paired with hidden inputs)
 *   - everything else        → the raw string for Zod to coerce
 *
 * For repeated keys (e.g. a hidden `<input type="hidden" name="x" value="false">`
 * immediately before a `<Switch name="x" value="true">`) the LAST value wins,
 * matching DOM submission semantics.
 */

export function formToObject(form: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key);
    const last = values[values.length - 1];
    if (typeof last !== "string") {
      obj[key] = last;
      continue;
    }
    if (last === "") obj[key] = undefined;
    else if (last === "_none") obj[key] = null;
    else if (last === "true" || last === "on") obj[key] = true;
    else if (last === "false" || last === "off") obj[key] = false;
    else obj[key] = last;
  }
  return obj;
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      /**
       * Operator error code (E-XXXX-YYYY). Generated server-side
       * by lib/op-error.ts and included whenever the action's
       * failure path went through a catch block that called
       * `op.log(err)`. The UI surfaces the code next to the
       * message so the operator can paste it into Claude / Claude
       * Code along with a grep of the logs. See docs/CLAUDE_TROUBLESHOOTING.md.
       */
      code?: string;
    };
