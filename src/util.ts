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
