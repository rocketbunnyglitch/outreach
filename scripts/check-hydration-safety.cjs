#!/usr/bin/env node
/**
 * Hydration-safety guardrail. Fails (exit 1) on ERROR-tier violations:
 *   • localStorage / sessionStorage / indexedDB / document.cookie / navigator.*
 *     read DURING RENDER or in a useState/useMemo/useRef initializer in a
 *     "use client" component → server (no browser state) vs a populated client
 *     diverge → React #418/#419 inside a loading.tsx <Suspense> boundary →
 *     FROZEN page (the AccountSwitcher class). Incognito (empty state) masks it.
 *   • Unpinned toLocale*(): server (Node ICU) vs non-en-US browser diverge.
 *   • DATE formatter without an explicit `timeZone` on the render path: the
 *     prod VPS runs in UTC, so toLocaleDateString/Time/String + Intl.DateTimeFormat
 *     with date/time fields format in UTC server-side but the browser's local
 *     zone client-side → #418 "text" mismatch → freeze for every operator
 *     outside UTC. Pin `timeZone` (UTC for date-only, "America/Toronto" for live
 *     timestamps). If the call is provably hydration-safe (mount-gated +
 *     suppressHydrationWarning at the call site, open-gated portal, or only
 *     reached from a handler), annotate the line — or the line above — with a
 *     `hydration-safe-tz` comment to exempt it. See memory:
 *     reference_hydration_timezone_418.md.
 * WARN-tier (does NOT fail the build): new Date()/Date.now()/Math.random()/
 *   performance.now() during render — recoverable #418; many false positives
 *   (value not rendered, client-only popovers). Review but non-blocking.
 *
 * Read storage/clock in useEffect (mount-gate) or use suppressHydrationWarning
 * for intentional timestamps. See memory: reference_stale_chunk_crash.md.
 */
const ts = require("typescript");
const fs = require("fs");
const cp = require("child_process");
const clientFiles = cp
  .execSync(`grep -rl '"use client"' app components --include=*.tsx --include=*.ts`, {
    encoding: "utf8",
  })
  .trim()
  .split("\n")
  .filter(Boolean);
const ERR_IDENT = new Set(["localStorage", "sessionStorage", "indexedDB"]);
const ERR_PROP = [/^document\.cookie$/, /^navigator\./, /^window\.(localStorage|sessionStorage)$/];
const WARN_PROP = [
  /^Date\.now$/,
  /^Math\.random$/,
  /^performance\.now$/,
  /^window\.(matchMedia|innerWidth|innerHeight)$/,
];
// Option keys that make a toLocaleString() a DATE format (vs a number format).
const DATE_OPT_KEYS = new Set([
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
  "dateStyle",
  "timeStyle",
  "dayPeriod",
  "fractionalSecondDigits",
  "timeZoneName",
]);
const errors = [],
  warns = [];
const chain = (n) =>
  ts.isPropertyAccessExpression(n)
    ? chain(n.expression) + "." + n.name.text
    : ts.isIdentifier(n)
      ? n.text
      : "";
const encFns = (n) => {
  const o = [];
  let p = n.parent;
  while (p) {
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isFunctionDeclaration(p))
      o.push(p);
    p = p.parent;
  }
  return o;
};
const isInit = (fn) => {
  const c = fn && fn.parent;
  return (
    c &&
    ts.isCallExpression(c) &&
    ts.isIdentifier(c.expression) &&
    ["useState", "useMemo", "useRef"].includes(c.expression.text) &&
    c.arguments[0] === fn
  );
};
const objHasKey = (node, key) =>
  node &&
  ts.isObjectLiteralExpression(node) &&
  node.properties.some(
    (p) =>
      p.name &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === key,
  );
const objHasDateKey = (node) =>
  node &&
  ts.isObjectLiteralExpression(node) &&
  node.properties.some(
    (p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && DATE_OPT_KEYS.has(p.name.text),
  );
function scan(file) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  // A call is render-path if it sits in exactly one enclosing function (the
  // component or a module-level format helper), or in a useState/useMemo/useRef
  // initializer. Nested deeper (effect/handler/.then/.map cb) → treated as safe.
  const renderKind = (n) => {
    const fns = encFns(n);
    if (fns[0] && isInit(fns[0])) return "initializer";
    if (fns.length === 1) return "render body";
    return false;
  };
  const tzExempt = (n) => {
    const ln = at(n);
    if (
      (lines[ln - 1] && lines[ln - 1].includes("hydration-safe-tz")) ||
      (lines[ln - 2] && lines[ln - 2].includes("hydration-safe-tz"))
    )
      return true;
    // A `hydration-safe-tz` marker anywhere inside the immediately enclosing
    // function (e.g. a one-line note in a format helper) exempts every date
    // formatter in that function — so a helper with several formatters needs
    // only one annotation.
    const fn = encFns(n)[0];
    return !!(fn && src.slice(fn.getFullStart(), fn.getEnd()).includes("hydration-safe-tz"));
  };
  (function visit(n) {
    let tier = null,
      what = null;
    if (
      ts.isIdentifier(n) &&
      ERR_IDENT.has(n.text) &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)
    ) {
      tier = "E";
      what = n.text;
    } else if (ts.isPropertyAccessExpression(n)) {
      const c = chain(n);
      if (ERR_PROP.some((r) => r.test(c))) {
        tier = "E";
        what = c;
      } else if (WARN_PROP.some((r) => r.test(c))) {
        tier = "W";
        what = c;
      }
    } else if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "Date" &&
      (!n.arguments || n.arguments.length === 0)
    ) {
      tier = "W";
      what = "new Date()";
    }
    if (tier) {
      const fns = encFns(n);
      const inner = fns[0];
      let render = false;
      if (inner && isInit(inner)) render = "initializer";
      else if (fns.length === 1) render = "render body";
      if (render) {
        (tier === "E" ? errors : warns).push(`${file}:${at(n)}  [${what}]  ${render}`);
      }
    }
    // unpinned locale (ERROR)
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text;
      if (["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].includes(m)) {
        const a = n.arguments[0];
        if (n.arguments.length === 0 || (a && a.kind === ts.SyntaxKind.UndefinedKeyword))
          errors.push(`${file}:${at(n)}  [${m}() unpinned locale]  any-scope`);
      }
    }
    // unpinned timeZone on a render-path DATE formatter (ERROR; exempt via
    // `hydration-safe-tz` comment when provably gated at the call site).
    {
      let kind = null,
        opts = null;
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const m = n.expression.name.text;
        if (m === "toLocaleDateString" || m === "toLocaleTimeString") {
          kind = m;
          opts = n.arguments[1];
        } else if (m === "toLocaleString" && objHasDateKey(n.arguments[1])) {
          // toLocaleString is a date format only when given date/time fields;
          // a bare number .toLocaleString("en-US") is timezone-agnostic & safe.
          kind = m;
          opts = n.arguments[1];
        }
      } else if (
        ts.isNewExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        chain(n.expression) === "Intl.DateTimeFormat"
      ) {
        kind = "Intl.DateTimeFormat";
        opts = n.arguments[1];
      }
      if (kind && !objHasKey(opts, "timeZone")) {
        const render = renderKind(n);
        if (render && !tzExempt(n)) {
          errors.push(
            `${file}:${at(n)}  [${kind}() missing timeZone — UTC server vs local client #418]  ${render}`,
          );
        }
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
}
clientFiles.forEach(scan);
console.log(
  `hydration-safety: scanned ${clientFiles.length} client files — ${errors.length} ERROR, ${warns.length} warn`,
);
if (warns.length) {
  console.log("\n-- warnings (advisory, non-blocking) --");
  warns.forEach((w) => console.log("  " + w));
}
if (errors.length) {
  console.log("\n✗ ERRORS (blocking):");
  errors.forEach((e) => console.log("  " + e));
  process.exit(1);
}
console.log("\n✓ no blocking hydration-safety violations");
