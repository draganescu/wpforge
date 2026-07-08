// `wpforge fix <output-dir>` — the visual repair pass. GLM writes code blind;
// this renders the generated site in WordPress Playground, has a Gemini vision
// model look at one screenshot per template surface, and lets GLM author a CSS
// override patch for the GLARING defects it finds. Then it re-renders to verify.
//
// Fix surface is CSS only (one file, safe to patch and re-verify); templates and
// PHP are out of scope by design. The loop is capped so it stays fast.
import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config";
import { VisionModel, type VisualDefect } from "./vision";
import {
  capture,
  ensureBlueprint,
  launchBrowser,
  previewTargets,
  recapture,
  startServer,
  type Shot,
} from "./preview";
import { pLimit, log } from "./util";

const MAX_PATCHES = 2;

interface Manifest {
  brief?: { postTypes?: { key: string }[] };
  design?: { artDirection?: string; palette?: Record<string, string> };
  contract?: { themeSlug?: string; themeName?: string };
}

export interface FixReport {
  screenshots: string[];
  defectsFound: number;
  patchesApplied: number;
  remaining: number;
  themeCssPath: string;
}

/** Balanced-brace, non-empty check for an appended override block. */
function usablePatch(css: string): boolean {
  const s = (css ?? "").trim();
  if (s.length < 8) return false;
  const opens = (s.match(/\{/g) ?? []).length;
  const closes = (s.match(/\}/g) ?? []).length;
  return opens > 0 && opens === closes;
}

function readManifest(outDir: string): Manifest {
  const p = path.join(outDir, "wpforge-manifest.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Manifest;
  } catch {
    return {};
  }
}

function themeStyleCssPath(outDir: string): { themeSlug: string; cssPath: string } {
  const themesDir = path.join(outDir, "wp-content", "themes");
  const themeSlug = fs.readdirSync(themesDir).find((d) => fs.statSync(path.join(themesDir, d)).isDirectory());
  if (!themeSlug) throw new Error(`No theme found under ${themesDir}`);
  return { themeSlug, cssPath: path.join(themesDir, themeSlug, "style.css") };
}

export async function runFix(cfg: Config, outDir: string): Promise<FixReport> {
  if (!fs.existsSync(path.join(outDir, "wp-content"))) {
    throw new Error(`${outDir} does not look like a wpforge output (no wp-content/).`);
  }
  if (!cfg.geminiApiKey) {
    throw new Error("wpforge fix needs GEMINI_API_KEY (the vision model). Add it to .env.");
  }
  const manifest = readManifest(outDir);
  const { cssPath } = themeStyleCssPath(outDir);
  const concept = manifest.design?.artDirection ?? "";
  const palette = manifest.design?.palette;
  const cptKeys = (manifest.brief?.postTypes ?? []).map((p) => p.key);
  const shotDir = path.join(outDir, ".wpforge-preview");
  const blueprintPath = ensureBlueprint(outDir);

  const vision = new VisionModel({ apiKey: cfg.geminiApiKey, model: cfg.visionModel });
  const targets = previewTargets(cptKeys);

  // Prewarm: boot Playground and launch Chromium concurrently. One server + one
  // browser stay warm for the whole run (initial shots and every verify reload).
  log.step("Booting the site in WordPress Playground + launching browser");
  const note = (m: string) => log.info(m);
  const [server, browser] = await Promise.all([
    startServer(outDir, blueprintPath, { port: cfg.port, wp: cfg.wp, verbose: cfg.verbose }),
    launchBrowser(note),
  ]);

  let patchesApplied = 0;
  let lastDefects: VisualDefect[] = [];
  let shots: Shot[] = [];

  try {
    log.step(`Capturing ${targets.length} template surfaces`);
    shots = await capture(browser, server.baseUrl, targets, shotDir, note);
    for (const s of shots) log.ok(`shot ${s.surface} → ${path.basename(s.path)}`);

    const diagLimit = pLimit(4);
    const runDiagnose = async (list: Shot[]): Promise<VisualDefect[]> => {
      const all = await Promise.all(
        list.map((s) =>
          diagLimit(() => vision.diagnose(s.path, { surface: s.surface, viewport: s.viewport.label, palette }))
        )
      );
      return all.flat();
    };

    log.step("Diagnosing screenshots (Gemini vision)");
    lastDefects = await runDiagnose(shots);
    const glaring = (ds: VisualDefect[]) => ds.filter((d) => d.severity === "high" || d.severity === "med");
    log.info(`${lastDefects.length} defect(s), ${glaring(lastDefects).length} glaring`);

    const firstCount = glaring(lastDefects).length;

    while (glaring(lastDefects).length && patchesApplied < MAX_PATCHES) {
      const issues = glaring(lastDefects).slice(0, 20);
      for (const d of issues) log.warn(`${d.surface}: ${d.description}`);

      log.step("Authoring a CSS fix (Gemini, multimodal)");
      const currentCss = fs.readFileSync(cssPath, "utf8");
      // Pair each affected surface's screenshot with its own defects, so Gemini
      // sees the actual broken pixels alongside the stylesheet it's patching.
      const items = shots
        .filter((s) => issues.some((d) => d.surface === s.surface))
        .map((s) => ({
          surface: s.surface,
          imagePath: s.path,
          defects: issues.filter((d) => d.surface === s.surface),
        }));
      let patch = "";
      for (let attempt = 1; attempt <= 2 && !patch; attempt++) {
        const css = await vision.authorFix({ concept, currentCss, items });
        if (usablePatch(css)) patch = css;
      }
      if (!patch) {
        log.warn("could not produce a usable CSS fix — leaving the stylesheet unchanged.");
        break;
      }
      fs.writeFileSync(
        cssPath,
        currentCss.trimEnd() +
          `\n\n/* wpforge fix: overrides for vision-detected defects (pass ${patchesApplied + 1}) */\n` +
          patch +
          "\n"
      );
      patchesApplied++;
      log.ok(`applied fix pass ${patchesApplied} to ${path.basename(cssPath)}`);

      // The theme is live-mounted, so a cache-disabled reload on the SAME
      // (still-seeded, still-authenticated) server serves the patched CSS — no
      // restart, so we never lose the seeded content. Re-shoot the surfaces that
      // had glaring defects and re-diagnose.
      log.step("Re-capturing to verify the fix");
      const affected = new Set(issues.map((d) => d.surface));
      const toRecheck = shots.filter((s) => affected.has(s.surface));
      await recapture(browser, server.baseUrl, toRecheck, note);
      lastDefects = await runDiagnose(toRecheck);
      log.info(`${glaring(lastDefects).length} glaring defect(s) remain on rechecked surfaces`);
    }

    return {
      screenshots: shots.map((s) => s.path),
      defectsFound: firstCount,
      patchesApplied,
      remaining: glaring(lastDefects).length,
      themeCssPath: cssPath,
    };
  } finally {
    server.stop();
    await browser.close().catch(() => {});
  }
}
