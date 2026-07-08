// Spin the generated wp-content up in WordPress Playground (PHP-WASM, SQLite),
// then drive a headless Chromium over one page per template surface and
// screenshot each. This is the "eyes" half of `wpforge fix`: GLM can't see, so
// we render the real site and hand pixels to a vision model.
//
// Prewarm: boot ONE Playground server and ONE browser and keep both warm for
// the whole session (initial shots + verify re-shots share them); the server
// boot and the browser launch are started concurrently; Playground caches WP
// core across runs so only the first ever boot pays the download.
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

// ─── Blueprint (deterministic per output) ───────────────────────────────────
export interface PreviewBlueprint {
  $schema: string;
  landingPage: string;
  login: boolean;
  steps: Array<Record<string, unknown>>;
}

/** Build the Playground blueprint for an output: log in as admin, activate the
 *  theme, then the plugins in order, and land on wp-admin so the (admin_init)
 *  seeder runs. Pure — safe to write at assemble time and re-read at fix time. */
export function buildPreviewBlueprint(themeSlug: string, pluginSlugs: string[]): PreviewBlueprint {
  return {
    $schema: "https://playground.wordpress.net/blueprint-schema.json",
    landingPage: "/wp-admin/",
    login: true,
    steps: [
      // Disable the admin toolbar site-wide so it never pollutes front-end
      // screenshots (we still log in as admin, which is what the seeder needs).
      { step: "mkdir", path: "/wordpress/wp-content/mu-plugins" },
      {
        step: "writeFile",
        path: "/wordpress/wp-content/mu-plugins/00-wpforge-preview.php",
        data: "<?php add_filter( 'show_admin_bar', '__return_false' );\n",
      },
      { step: "activateTheme", themeFolderName: themeSlug },
      ...pluginSlugs.map((slug) => ({ step: "activatePlugin", pluginPath: `${slug}/${slug}.php` })),
    ],
  };
}

export const PREVIEW_BLUEPRINT_FILE = "wpforge-preview-blueprint.json";

/** Ensure the preview blueprint exists on disk for an output, building it from
 *  the theme + plugins (content-model first, seed last, features between) if an
 *  older output predates blueprint-saving. Returns its path. Shared by `serve`
 *  and `fix`. */
export function ensureBlueprint(outDir: string): string {
  const themesDir = path.join(outDir, "wp-content", "themes");
  const themeSlug = fs.readdirSync(themesDir).find((d) => fs.statSync(path.join(themesDir, d)).isDirectory());
  if (!themeSlug) throw new Error(`No theme found under ${themesDir}`);
  const pluginsDir = path.join(outDir, "wp-content", "plugins");
  const rank = (s: string) => (s.endsWith("-content-model") ? 0 : s.endsWith("-seed") ? 2 : 1);
  const plugins = fs
    .readdirSync(pluginsDir)
    .filter((d) => fs.statSync(path.join(pluginsDir, d)).isDirectory())
    .sort((a, b) => rank(a) - rank(b));
  const bp = path.join(outDir, PREVIEW_BLUEPRINT_FILE);
  if (!fs.existsSync(bp)) {
    fs.writeFileSync(bp, JSON.stringify(buildPreviewBlueprint(themeSlug, plugins), null, 2));
  }
  return bp;
}

// ─── Preview targets (one per template surface, not per page) ────────────────
export interface Viewport {
  width: number;
  height: number;
  label: string;
}
export const DESKTOP: Viewport = { width: 1280, height: 900, label: "desktop" };
export const MOBILE: Viewport = { width: 390, height: 844, label: "mobile" };

export interface PreviewTarget {
  /** template surface this exercises, e.g. "front-page", "archive-class" */
  surface: string;
  /** absolute path when static, or a two-step navigation when derived */
  url?: string;
  /** derive the url by loading `from` and taking the first link matching `pick` */
  derive?: { from: string; pick: string };
  viewport: Viewport;
}

/** Query-based URLs work under WordPress's default (plain) permalinks, so we
 *  don't depend on the seeder having flushed rewrite rules. Singles are derived
 *  by navigation because their ids/slugs aren't known up front. cptKeys come
 *  from the brief (the manifest). */
export function previewTargets(cptKeys: string[]): PreviewTarget[] {
  const firstCpt = cptKeys[0];
  const targets: PreviewTarget[] = [
    { surface: "front-page", url: "/", viewport: DESKTOP },
    { surface: "front-page (mobile)", url: "/", viewport: MOBILE },
    { surface: "archive", url: "/?author=1", viewport: DESKTOP },
    { surface: "search", url: "/?s=the", viewport: DESKTOP },
    { surface: "404", url: "/?p=99999999", viewport: DESKTOP },
    // page: first nav-menu link that isn't the front page
    { surface: "page", derive: { from: "/", pick: ".nav-menu a, .main-navigation a" }, viewport: DESKTOP },
    // single post: first post permalink off the author archive
    { surface: "single", derive: { from: "/?author=1", pick: "a[rel~='bookmark'], h1 a, h2 a, h3 a, .entry-title a, article a" }, viewport: DESKTOP },
  ];
  if (firstCpt) {
    targets.push({ surface: `archive-${firstCpt}`, url: `/?post_type=${firstCpt}`, viewport: DESKTOP });
    targets.push({
      surface: `single-${firstCpt}`,
      derive: { from: `/?post_type=${firstCpt}`, pick: "h1 a, h2 a, h3 a, .entry-title a, article a, .card a" },
      viewport: DESKTOP,
    });
  }
  return targets;
}

// ─── Playground server ──────────────────────────────────────────────────────
function playgroundBin(): string {
  const pkgJson = require.resolve("@wp-playground/cli/package.json");
  const dir = path.dirname(pkgJson);
  const bin = require(pkgJson).bin;
  const rel = typeof bin === "string" ? bin : bin["wp-playground-cli"] ?? Object.values(bin)[0];
  return path.join(dir, rel as string);
}

export interface Server {
  baseUrl: string;
  stop: () => void;
}

/** Bind-test the preferred port; if it's busy (other Playground servers,
 *  leftover workers), let the OS pick a free one. Avoids EADDRINUSE crashes. */
function getFreePort(preferred: number): Promise<number> {
  const tryBind = (p: number) =>
    new Promise<number | null>((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(null));
      s.once("listening", () => {
        const addr = s.address();
        const chosen = typeof addr === "object" && addr ? addr.port : p;
        s.close(() => resolve(chosen));
      });
      s.listen(p, "127.0.0.1");
    });
  return tryBind(preferred).then((p) => p ?? tryBind(0).then((r) => r as number));
}

/** Mount the theme and every plugin under wp-content individually (so
 *  Playground's own wp-content — the SQLite integration — stays intact), then
 *  boot the server and resolve once it prints its ready URL. The theme is
 *  mounted live, so CSS patches written to disk are picked up on reload. */
export async function startServer(
  outDir: string,
  blueprintPath: string,
  opts: { port?: number; wp?: string; verbose?: boolean } = {}
): Promise<Server> {
  const wpContent = path.join(outDir, "wp-content");
  const themesDir = path.join(wpContent, "themes");
  const pluginsDir = path.join(wpContent, "plugins");
  const themeName = fs.readdirSync(themesDir).find((d) => fs.statSync(path.join(themesDir, d)).isDirectory());
  if (!themeName) throw new Error(`No theme found under ${themesDir}`);

  const mounts: string[] = [
    "--mount",
    `${path.join(themesDir, themeName)}:/wordpress/wp-content/themes/${themeName}`,
  ];
  for (const p of fs.readdirSync(pluginsDir)) {
    const abs = path.join(pluginsDir, p);
    if (!fs.statSync(abs).isDirectory()) continue;
    mounts.push("--mount", `${abs}:/wordpress/wp-content/plugins/${p}`);
  }

  const port = await getFreePort(opts.port ?? 9400);
  const args = [
    playgroundBin(),
    "server",
    "--port",
    String(port),
    "--login",
    "--blueprint",
    blueprintPath,
    ...(opts.wp ? ["--wp", opts.wp] : []),
    ...mounts,
  ];

  const proc = spawn("node", args, { stdio: ["ignore", "pipe", "pipe"] });
  return await waitForReady(proc, port, !!opts.verbose);
}

function waitForReady(proc: ChildProcess, port: number, verbose: boolean): Promise<Server> {
  return new Promise((resolve, reject) => {
    let out = "";
    let settled = false;
    const stop = () => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        stop();
        reject(new Error(`Playground did not become ready in 120s.\n${out.slice(-500)}`));
      }
    }, 120_000);

    const onData = (buf: Buffer) => {
      const s = buf.toString();
      out += s;
      if (verbose) process.stderr.write(s);
      const m = out.match(/https?:\/\/127\.0\.0\.1:\d+/);
      if (!settled && /Ready!\s+WordPress is running/i.test(out) && m) {
        settled = true;
        clearTimeout(timer);
        resolve({ baseUrl: m[0], stop });
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Playground exited (code ${code}) before ready.\n${out.slice(-500)}`));
      }
    });
  });
}

// ─── Browser capture ────────────────────────────────────────────────────────
export interface Shot {
  surface: string;
  /** path + query relative to the base URL, so it survives a server restart
   *  (boot picks a fresh port; slugs are deterministic so the path is stable) */
  urlPath: string;
  viewport: Viewport;
  /** absolute path to the PNG on disk */
  path: string;
}

// puppeteer is a heavy dep; load it only when a fix actually runs.
type Browser = { newPage: () => Promise<Page>; close: () => Promise<void> };
type Page = {
  setViewport: (v: { width: number; height: number }) => Promise<void>;
  setCacheEnabled: (enabled: boolean) => Promise<void>;
  goto: (url: string, o?: unknown) => Promise<unknown>;
  evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown>;
  screenshot: (o: unknown) => Promise<unknown>;
  close: () => Promise<void>;
};

/** Find a usable Chrome for puppeteer, tolerating hostile environments. We
 *  deliberately IGNORE any PUPPETEER_EXECUTABLE_PATH override: on this machine
 *  (and many dev setups) it points at a homebrew cask wrapper whose target app
 *  no longer exists — the path "exists" as a file but fails at exec (code 126).
 *  wpforge always uses a puppeteer-managed Chrome for Testing, downloading it
 *  once if PUPPETEER_SKIP_CHROMIUM_DOWNLOAD left none. */
async function resolveChromeExecutable(onNote?: (m: string) => void): Promise<string | undefined> {
  delete process.env.PUPPETEER_EXECUTABLE_PATH;

  const puppeteer = require("puppeteer");
  try {
    // puppeteer 25's executablePath() is async.
    const p = await puppeteer.executablePath();
    if (typeof p === "string" && fs.existsSync(p)) return p;
  } catch {
    /* not resolvable — fall through to install */
  }

  try {
    const os = require("node:os") as typeof import("node:os");
    const { install, Browser, resolveBuildId, detectBrowserPlatform } = require("@puppeteer/browsers");
    const cacheDir = path.join(os.homedir(), ".cache", "puppeteer");
    const platform = detectBrowserPlatform();
    const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
    onNote?.(`no local Chrome found — downloading Chrome for Testing (${buildId})…`);
    const installed = await install({ browser: Browser.CHROME, buildId, cacheDir });
    return installed.executablePath as string;
  } catch (e) {
    onNote?.(`could not provision Chrome: ${(e as Error)?.message ?? e}`);
    return undefined;
  }
}

export async function launchBrowser(onNote?: (m: string) => void): Promise<Browser> {
  const puppeteer = require("puppeteer");
  const executablePath = await resolveChromeExecutable(onNote);
  if (!executablePath) {
    throw new Error(
      "No usable Chrome for the preview. Install one with `npx puppeteer browsers install chrome`, " +
        "or point PUPPETEER_EXECUTABLE_PATH at a real Chrome binary."
    );
  }
  return (await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })) as unknown as Browser;
}

// Injected before every screenshot: reveal all motion blocks (so we judge the
// resting layout, not a mid-animation frame), kill animations/transitions for a
// stable shot, and fully remove the admin bar (login mode renders it on the
// front end; removing the node — not just hiding it — keeps it out of the shot
// and undoes the html margin-top WordPress adds for it).
const PREP_FN = `() => {
  document.documentElement.classList.add('js');
  document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-visible'));
  const bar = document.getElementById('wpadminbar');
  if (bar) bar.remove();
  document.documentElement.style.setProperty('margin-top', '0', 'important');
  document.body && document.body.classList.remove('admin-bar');
  const s = document.createElement('style');
  s.textContent = 'html{margin-top:0!important} #wpadminbar{display:none!important} *{animation:none!important;transition:none!important;scroll-behavior:auto!important}';
  document.head.appendChild(s);
}`;

async function resolveUrl(page: Page, base: string, target: PreviewTarget): Promise<string | null> {
  if (target.url) return base + target.url;
  if (!target.derive) return null;
  await page.goto(base + target.derive.from, { waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
  const href = (await page.evaluate(
    `(() => {
      const base = location.origin;
      const home = base + '/';
      const els = Array.from(document.querySelectorAll(${JSON.stringify(target.derive.pick)}));
      for (const a of els) {
        const h = a.href;
        if (!h) continue;
        if (!h.startsWith(base)) continue;              // internal only
        if (h === home || h === base) continue;          // skip the home link
        if (/\\/(wp-admin|wp-login|feed)/.test(h)) continue;
        if (/[?&](author|s|post_type)=/.test(h)) continue; // skip listing/query links
        return h;
      }
      return null;
    })()`
  )) as string | null;
  return href;
}

/** Screenshot every target that resolves to a page. Reuses one page; skips
 *  (with a note) any derived target whose link can't be found. */
export async function capture(
  browser: Browser,
  baseUrl: string,
  targets: PreviewTarget[],
  outDir: string,
  onNote?: (msg: string) => void
): Promise<Shot[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const shots: Shot[] = [];
  const page = await browser.newPage();
  await page.setCacheEnabled(false); // so a patched style.css is re-fetched on reload
  // First authenticated admin hit triggers the one-time seeder (admin_init).
  await page.goto(baseUrl + "/wp-admin/", { waitUntil: "networkidle2", timeout: 60_000 }).catch(() => {});
  for (const t of targets) {
    const url = await resolveUrl(page, baseUrl, t);
    if (!url) {
      onNote?.(`skipped ${t.surface}: no link found`);
      continue;
    }
    try {
      await page.setViewport({ width: t.viewport.width, height: t.viewport.height });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
      await page.evaluate(PREP_FN);
      const file = path.join(outDir, `${t.surface.replace(/[^a-z0-9]+/gi, "-")}-${t.viewport.label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      shots.push({ surface: t.surface, urlPath: url.slice(baseUrl.length) || "/", viewport: t.viewport, path: file });
    } catch (e) {
      onNote?.(`skipped ${t.surface}: ${(e as Error)?.message ?? e}`);
    }
  }
  await page.close();
  return shots;
}

/** Re-screenshot specific surfaces after a CSS patch, on the SAME running
 *  server (seeded session preserved — no restart). The theme is live-mounted and
 *  style.css is enqueued with a filemtime version, so a cache-disabled reload
 *  serves the patched CSS. Overwrites the PNGs in place. */
export async function recapture(
  browser: Browser,
  baseUrl: string,
  shots: Shot[],
  onNote?: (msg: string) => void
): Promise<Shot[]> {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  const out: Shot[] = [];
  for (const s of shots) {
    try {
      await page.setViewport({ width: s.viewport.width, height: s.viewport.height });
      await page.goto(baseUrl + s.urlPath, { waitUntil: "networkidle2", timeout: 30_000 });
      await page.evaluate(PREP_FN);
      await page.screenshot({ path: s.path, fullPage: true });
      out.push(s);
    } catch (e) {
      onNote?.(`re-shot ${s.surface} failed: ${(e as Error)?.message ?? e}`);
    }
  }
  await page.close();
  return out;
}
