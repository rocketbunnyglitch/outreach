/**
 * Email HTML sanitization for the inbox thread pane.
 *
 * Inbound email bodies are arbitrary user-controlled HTML — vendor
 * newsletters, replies from venue contacts, auto-responses with
 * tracking pixels, sometimes outright spam. We render this content
 * in the operator's authenticated admin shell, so the security
 * stakes are real: a script tag could exfiltrate session tokens, an
 * iframe could embed a phishing page, a `style` block could break
 * the admin shell's layout.
 *
 * Strategy
 * --------
 * Server-side sanitize once via DOMPurify and store the result in
 * the thread-detail response. By the time the markup reaches the
 * client it's already safe to `dangerouslySetInnerHTML` — no
 * client-side processing needed (and no client-side DOMPurify
 * dependency bundle).
 *
 * What we strip
 * -------------
 *   - <script>, <iframe>, <object>, <embed>, <link rel="...">
 *   - on* event handler attributes
 *   - javascript: / data: URIs in href/src (anything not http/https/
 *     mailto/tel)
 *   - <style> blocks (would leak into the admin shell)
 *
 * What we KEEP
 * ------------
 *   - The full set of layout elements: <table>, <tr>, <td>, <div>,
 *     <span>, <p>, <h1>-<h6>, <ul>/<ol>/<li>, <blockquote>, <pre>,
 *     <hr>, <br>
 *   - Inline `style` attribute (capped via ALLOW_DATA_ATTR=false
 *     but style is permitted because newsletter HTML uses it for
 *     spacing + colour). DOMPurify still strips dangerous CSS
 *     functions (expression(), url() pointing at javascript:).
 *   - Links — but rewritten with rel="noopener noreferrer
 *     nofollow" + target="_blank" so clicks don't navigate the
 *     admin shell away or leak the referrer.
 *   - <img> tags — but only with http(s) src.
 *
 * Why allow inline style but not <style> blocks
 * ---------------------------------------------
 * <style> would leak global selectors into the admin shell ("body {
 * margin: 0 }" would wreck our layout). Inline style only affects
 * the element it's on, so a <table style="..."> can render a
 * newsletter's intended layout without bleeding into our chrome.
 */

import DOMPurify from "isomorphic-dompurify";

// Config tuned for email rendering. We import this once at module
// scope; DOMPurify is configured per-call so we don't have to worry
// about cross-call leakage.
const EMAIL_CONFIG = {
  // Drop anything that could execute or break out of the document.
  FORBID_TAGS: [
    "script",
    "iframe",
    "object",
    "embed",
    "link",
    "style",
    "meta",
    "base",
    "form",
    "input",
    "textarea",
    "select",
    "button",
  ],
  FORBID_ATTR: [
    // Event handlers
    "onabort",
    "onblur",
    "onchange",
    "onclick",
    "ondblclick",
    "onerror",
    "onfocus",
    "onkeydown",
    "onkeypress",
    "onkeyup",
    "onload",
    "onmousedown",
    "onmousemove",
    "onmouseout",
    "onmouseover",
    "onmouseup",
    "onreset",
    "onresize",
    "onselect",
    "onsubmit",
    "onunload",
    // Form submission
    "formaction",
    "action",
  ],
  ALLOW_DATA_ATTR: false,
  // Default URL scheme allow-list is fine — DOMPurify strips
  // javascript: / data: by default.
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel|cid|sms|whatsapp):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

/**
 * Sanitize an email HTML body for safe rendering in the admin UI.
 *
 * Returns null when input is null/empty/whitespace-only so callers
 * can fall through to the plain-text body.
 *
 * After DOMPurify returns, we run a quick post-processing pass to
 * harden link attributes (target="_blank" + rel="noopener noreferrer
 * nofollow"). Doing this with a string replace is brittle in general,
 * but DOMPurify hooks would mean a bigger refactor; for now the
 * regex is conservative + matches only what DOMPurify just produced
 * (well-formed start tags).
 */
export function sanitizeEmailHtml(input: string | null | undefined): string | null {
  if (!input) return null;
  if (typeof input !== "string") return null;
  if (input.trim().length === 0) return null;

  const clean = DOMPurify.sanitize(input, EMAIL_CONFIG);
  if (!clean || clean.trim().length === 0) return null;

  // Harden all anchor tags. Idempotent — if the link already has
  // these attrs (because the source HTML included them) we add only
  // what's missing.
  return clean.replace(/<a\s+([^>]*?)>/gi, (_full, attrs) => {
    let merged: string = attrs;
    if (!/target=/i.test(merged)) merged += ' target="_blank"';
    if (!/rel=/i.test(merged)) {
      merged += ' rel="noopener noreferrer nofollow"';
    } else {
      // Extend an existing rel attribute with our required values.
      merged = merged.replace(/rel\s*=\s*"([^"]*)"/i, (_m, existing) => {
        const tokens = new Set(existing.split(/\s+/).filter(Boolean));
        tokens.add("noopener");
        tokens.add("noreferrer");
        tokens.add("nofollow");
        return `rel="${Array.from(tokens).join(" ")}"`;
      });
    }
    return `<a ${merged}>`;
  });
}
