// Deterministic safety gates for the design phase. No model, no exceptions:
// a stylesheet that's truncated/empty or a motion script that could break the
// page (or hide content forever) must never ship. These run after generation
// and drive at most one retry each; motion that can't be made valid is dropped
// (safe, because the CSS only hides .reveal under html.js and the helpers only
// enable html.js when a valid script ships).
import vm from "node:vm";

export interface GateResult {
  ok: boolean;
  reason?: string;
}

// ─── Stylesheet gate ────────────────────────────────────────────────────────
const CSS_MIN_LEN = 1500; // a real theme stylesheet is many KB; anything tiny is truncated/degenerate
const CSS_MIN_RULES = 20;

/** Balanced-brace + minimum-substance check. Catches the truncated/degenerate
 *  stylesheet (the 22-line fallback) before it becomes style.css. */
export function validateCss(css: string): GateResult {
  const s = (css ?? "").trim();
  if (s.length < CSS_MIN_LEN) {
    return { ok: false, reason: `stylesheet too short (${s.length} < ${CSS_MIN_LEN} chars) — likely truncated` };
  }
  const opens = (s.match(/\{/g) ?? []).length;
  const closes = (s.match(/\}/g) ?? []).length;
  if (opens === 0 || opens !== closes) {
    return { ok: false, reason: `unbalanced braces (${opens} '{' vs ${closes} '}')` };
  }
  if (opens < CSS_MIN_RULES) {
    return { ok: false, reason: `too few rules (${opens} < ${CSS_MIN_RULES})` };
  }
  if (!/:root\b/.test(s)) {
    return { ok: false, reason: "missing :root token block" };
  }
  return { ok: true };
}

/** Strip CSS comments so a class named only inside a comment doesn't count as covered. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** Class names declared in the vocabulary/core that never appear as a selector
 *  in the stylesheet (so templates using them would render unstyled). BEM
 *  suffixes count as covering their base (.card covers .card__title). */
export function missingClasses(css: string, classNames: string[]): string[] {
  const body = stripCssComments(css);
  return classNames.filter((name) => {
    const esc = name.replace(RE_SPECIAL, "\\$&");
    // `.name` not immediately followed by another class-char (so `.card` does
    // not match `.cardigan`), but a following `-`/`_` (BEM) still counts.
    const re = new RegExp(`\\.${esc}(?![A-Za-z0-9])`);
    return !re.test(body);
  });
}

// ─── Motion-script gate ─────────────────────────────────────────────────────
const JS_MAX_LEN = 6000;

// Tokens that would let the script reach the network, execute strings, or break
// out of the inline <script> the helpers wrap it in.
const JS_FORBIDDEN: { re: RegExp; label: string }[] = [
  { re: /<\//, label: "</ (script breakout)" },
  { re: /<!--/, label: "<!-- (comment breakout)" },
  { re: /\beval\b/, label: "eval" },
  { re: /new\s+Function/, label: "new Function" },
  { re: /\bfetch\s*\(/, label: "fetch()" },
  { re: /XMLHttpRequest/, label: "XMLHttpRequest" },
  { re: /\bWebSocket\b/, label: "WebSocket" },
  { re: /document\s*\.\s*write/, label: "document.write" },
  { re: /\bimport\s*[\s(]/, label: "import" },
  { re: /\brequire\s*\(/, label: "require()" },
  { re: /https?:/i, label: "http(s): URL" },
];

/** Syntax-parse + forbidden-token + size gate for the bespoke motion script.
 *  Parsing (not running) via vm.Script catches syntax errors that would throw
 *  in the browser. An empty script is "invalid" here — the caller treats that
 *  as "no motion", which is a safe, static site. */
export function validateMotionJs(js: string): GateResult {
  const s = (js ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  if (s.length > JS_MAX_LEN) {
    return { ok: false, reason: `script too large (${s.length} > ${JS_MAX_LEN} chars)` };
  }
  for (const f of JS_FORBIDDEN) {
    if (f.re.test(s)) return { ok: false, reason: `forbidden token: ${f.label}` };
  }
  try {
    new vm.Script(s); // compile-only: validates syntax without executing
  } catch (e) {
    return { ok: false, reason: `syntax error: ${(e as Error)?.message ?? e}` };
  }
  return { ok: true };
}

// ─── Template class lint ────────────────────────────────────────────────────
// WordPress and the classic editor emit many classes the design never declares.
// Allow them (prefix or exact) so the post-fan-out lint only flags genuinely
// undefined structural classes the templates invented.
const WP_NATIVE_PREFIXES = [
  "wp-", "align", "gallery", "size-", "attachment-", "menu", "sub-menu", "page-", "post-",
  "comment", "children", "bypostauthor", "has-", "is-", "current-", "widget",
];
const WP_NATIVE_EXACT = new Set([
  "sticky", "screen-reader-text", "assistive-text", "nav-links", "nav-previous", "nav-next",
  "updated", "url", "fn", "says", "avatar", "logged-in-as", "comment-form", "hentry", "format-standard",
]);

/** Pull literal class tokens out of `class="…"` / `class='…'` attributes in
 *  generated PHP/HTML, ignoring any token that contains PHP/interpolation. */
export function usedClasses(content: string): Set<string> {
  const out = new Set<string>();
  const re = /class(?:Name)?\s*=\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    for (const tok of m[1].split(/\s+/)) {
      const t = tok.trim();
      if (!t) continue;
      if (/[<>${}()?]/.test(t)) continue; // skip PHP echoes / interpolation
      out.add(t);
    }
  }
  return out;
}

function isAllowedClass(name: string, allowed: Set<string>): boolean {
  const base = name.split(/--|__/)[0]; // BEM base
  if (allowed.has(name) || allowed.has(base)) return true;
  if (WP_NATIVE_EXACT.has(name)) return true;
  return WP_NATIVE_PREFIXES.some((p) => name.startsWith(p));
}

/** Classes used across the templates that are neither in the allowed design set
 *  nor WordPress-native — i.e. structural classes the model invented that the
 *  stylesheet never styled. Deduped, sorted, capped. */
export function unknownTemplateClasses(
  contents: string[],
  allowedClassNames: string[],
  cap = 24
): string[] {
  const allowed = new Set(allowedClassNames);
  const unknown = new Set<string>();
  for (const c of contents) {
    for (const cls of usedClasses(c)) {
      if (!isAllowedClass(cls, allowed)) unknown.add(cls);
    }
  }
  return [...unknown].sort().slice(0, cap);
}
