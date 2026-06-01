#!/usr/bin/env node
/**
 * Hydration-safety guardrail. Fails (exit 1) on ERROR-tier violations:
 *   • localStorage / sessionStorage / indexedDB / document.cookie / navigator.*
 *     read DURING RENDER or in a useState/useMemo/useRef initializer in a
 *     "use client" component → server (no browser state) vs a populated client
 *     diverge → React #418/#419 inside a loading.tsx <Suspense> boundary →
 *     FROZEN page (the AccountSwitcher class). Incognito (empty state) masks it.
 *   • Unpinned toLocale*(): server (Node ICU) vs non-en-US browser diverge.
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
function scan(file) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
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
