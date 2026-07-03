import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";

// ─── Concurrency limiter (tiny p-limit) ─────────────────────────────────────
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    const run = queue.shift();
    if (run) run();
  };
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

/** Run tasks with a concurrency cap; preserves input order in the result. */
export async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, i) => limit(() => fn(item, i))));
}

// ─── Code / JSON extraction from model output ───────────────────────────────

/** Strip a leading/trailing markdown code fence if the model wrapped output. */
export function stripCodeFence(s: string): string {
  let t = s.trim();
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/;
  const m = t.match(fence);
  if (m) return m[1].trim();
  // Also handle a stray opening fence with no closing one.
  t = t.replace(/^```[a-zA-Z0-9_-]*\s*\n/, "").replace(/\n```\s*$/, "");
  return t.trim();
}

/** Escape raw control characters (newlines/tabs) that appear INSIDE JSON string
 *  literals — the most common way model-emitted JSON is technically invalid.
 *  Relies on quotes being properly escaped (the harder unescaped-inner-quote
 *  case is left to the caller's LLM repair fallback). */
export function sanitizeJsonControlChars(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        out += ch;
        esc = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        esc = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inStr = false;
        continue;
      }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}

/** Return the first balanced {...} or [...] substring, or null. Skips braces
 *  inside string literals. */
function sliceBalanced(s: string): string | null {
  const start = s.search(/[{[]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Extract the first JSON object/array from a string. Tolerates prose, code
 *  fences, and literal newlines inside string values. */
export function extractJson<T = unknown>(raw: string): T {
  const cleaned = stripCodeFence(raw);
  const candidates = [cleaned, sliceBalanced(cleaned)].filter(Boolean) as string[];
  for (const cand of candidates) {
    try {
      return JSON.parse(cand) as T;
    } catch {
      /* try the control-char-sanitized form */
    }
    try {
      return JSON.parse(sanitizeJsonControlChars(cand)) as T;
    } catch {
      /* next candidate */
    }
  }
  throw new Error("No parseable JSON found in model output.");
}

// ─── String helpers ─────────────────────────────────────────────────────────
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

/** WordPress post_type keys: lowercase, underscores, <= 20 chars. */
export function postTypeKey(s: string): string {
  return slugify(s).replace(/-/g, "_").slice(0, 20).replace(/_+$/g, "") || "item";
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1));
}

/** Escape a JS string for embedding inside single-quoted PHP. */
export function phpSingleQuote(s: string): string {
  return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

/** PHP internal functions models like to pass as WordPress sanitize callbacks.
 *  WordPress invokes meta sanitize filters with 3-4 arguments; PHP 8 throws
 *  ArgumentCountError when an internal function receives extra args, which
 *  white-screens the site the first time the meta value is written. */
const PHP_BUILTIN_CALLBACKS =
  "floatval|doubleval|intval|boolval|strval|trim|strtolower|strtoupper|lcfirst|ucfirst|ucwords|abs|round|ceil|floor|strip_tags|stripslashes|htmlspecialchars";

/** Rewrite `'sanitize_callback' => 'floatval'` (any quote style, any builtin
 *  from the list above) into a single-argument closure so extra filter args
 *  never reach the PHP internal. WP userland sanitizers are left alone —
 *  they ignore extra args safely. */
export function hardenPhpCallbacks(php: string): string {
  const re = new RegExp(
    `(['"]sanitize_callback['"]\\s*=>\\s*)(['"])(${PHP_BUILTIN_CALLBACKS})\\2`,
    "g"
  );
  return php.replace(
    re,
    (_m, prefix, _q, fn) =>
      `${prefix}static function ( $value ) { return ${fn}( $value ); }`
  );
}

/** Repair the known wp_nav_menu drift: the class vocabulary defines .nav-menu
 *  as the menu <ul> (and the stylesheet styles it that way), but header.php
 *  models sometimes emit 'container_class' => 'nav-menu' — a wrapper div —
 *  leaving the real <ul> browser-styled (bullets, indent). Move the class onto
 *  the <ul> itself. Skipped when the file already sets menu_class. */
export function hardenNavMenuArgs(php: string): string {
  if (/['"]menu_class['"]/.test(php)) return php;
  return php.replace(
    /(['"])container_class\1\s*=>\s*(['"])nav-menu\2/g,
    (_m, q1, q2) => `${q1}container${q1} => false, ${q1}menu_class${q1} => ${q2}nav-menu${q2}`
  );
}

// Filler words that make two slugs for the same page differ ("book-a-dive"
// vs "book-dive"). Both slugs and onPage references are LLM-generated in
// separate calls, so they never agree reliably on these.
const SLUG_STOPWORDS = new Set(["a", "an", "the", "and", "or", "of", "to", "us", "our", "your"]);

function slugTokens(slug: string): Set<string> {
  return new Set(slug.split("-").filter((t) => t && !SLUG_STOPWORDS.has(t)));
}

/** Resolve an LLM-written page reference against the actual page slugs.
 *  Exact match first, then stopword-insensitive token comparison, then
 *  best token-subset overlap. Returns undefined when nothing plausibly
 *  refers to the same page. */
export function resolvePageSlug(want: string, slugs: string[]): string | undefined {
  if (slugs.includes(want)) return want;
  const wantTokens = slugTokens(want);
  if (!wantTokens.size) return undefined;
  let best: string | undefined;
  let bestScore = 0;
  for (const slug of slugs) {
    const tokens = slugTokens(slug);
    if (!tokens.size) continue;
    const inter = [...wantTokens].filter((t) => tokens.has(t)).length;
    // Only a subset relation counts as "the same page" — partial overlap
    // ("dive-sites" vs "book-dive") is a different page, not a typo.
    if (inter !== Math.min(wantTokens.size, tokens.size)) continue;
    const score = inter / Math.max(wantTokens.size, tokens.size);
    if (score > bestScore) {
      bestScore = score;
      best = slug;
    }
  }
  return best;
}

/** Backstop for feature shortcodes the page copywriter failed to embed:
 *  if a feature's shortcode appears on no page, append it to the page its
 *  brief points at (onPage, falling back to the feature key/name). Mutates
 *  page content in place and returns what was placed and what couldn't be. */
export function placeMissingShortcodes(
  pages: { slug: string; content: string }[],
  features: { key: string; name: string; shortcode?: string; onPage?: string }[]
): { placed: { shortcode: string; page: string }[]; unplaced: string[] } {
  const placed: { shortcode: string; page: string }[] = [];
  const unplaced: string[] = [];
  const slugs = pages.map((p) => p.slug);
  for (const f of features) {
    if (!f.shortcode) continue;
    const tag = `[${f.shortcode}]`;
    if (pages.some((p) => p.content.includes(tag))) continue;
    const candidates = [f.onPage, f.key, slugify(f.name)].filter(Boolean) as string[];
    let target: string | undefined;
    for (const c of candidates) {
      target = resolvePageSlug(c, slugs);
      if (target) break;
    }
    if (!target) {
      unplaced.push(f.shortcode);
      continue;
    }
    const page = pages.find((p) => p.slug === target)!;
    page.content = page.content ? `${page.content}\n\n${tag}` : tag;
    placed.push({ shortcode: f.shortcode, page: target });
  }
  return { placed, unplaced };
}

// ─── FS helpers ─────────────────────────────────────────────────────────────
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeFileSafe(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

export function estimateTokens(s: string): number {
  // ~3.7 chars/token for code is a reasonable rough estimate.
  return Math.round(s.length / 3.7);
}

// ─── Logger ─────────────────────────────────────────────────────────────────
export const log = {
  banner(s: string) {
    console.log("\n" + pc.bold(pc.cyan(s)));
  },
  step(s: string) {
    console.log(pc.bold(pc.magenta("▸ ")) + pc.bold(s));
  },
  info(s: string) {
    console.log(pc.dim("  " + s));
  },
  ok(s: string) {
    console.log(pc.green("  ✓ ") + s);
  },
  warn(s: string) {
    console.log(pc.yellow("  ! ") + s);
  },
  err(s: string) {
    console.log(pc.red("  ✗ ") + s);
  },
  done(label: string, ms: number, tokens: number) {
    const t = `${(ms / 1000).toFixed(1)}s`;
    const tk = tokens ? `, ${tokens.toLocaleString()} tok` : "";
    console.log(pc.green("  ✓ ") + label + pc.dim(`  (${t}${tk})`));
  },
  fail(label: string, ms: number, msg: string) {
    console.log(
      pc.red("  ✗ ") + label + pc.dim(`  (${(ms / 1000).toFixed(1)}s)`) + " " + pc.red(msg)
    );
  },
};
