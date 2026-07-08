#!/usr/bin/env node
// wpforge — generate a complete classic WordPress site from a prompt using
// Cerebras + Qwen3-Coder. Brief → design system → theme + plugins + seeded
// content, fanned out concurrently for speed. `wpforge fix <dir>` then renders
// the result and repairs glaring visual defects with a vision model.
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { loadDotEnv, resolveConfig, type CliOverrides } from "./config";
import { Cerebras, type Model } from "./cerebras";
import { DryModel } from "./dryModel";
import { forge } from "./pipeline";
import { writeForge } from "./assemble";
import { runFix } from "./fix";
import { ensureBlueprint, startServer } from "./preview";
import { log } from "./util";

async function runGenerate(prompt: string, opts: Record<string, unknown>): Promise<void> {
  const overrides: CliOverrides = {
    model: opts.model as string | undefined,
    concurrency: opts.concurrency as number | undefined,
    output: opts.output as string | undefined,
    reasoning: opts.reasoning as string | undefined,
    rpm: opts.rpm as number | undefined,
    tpm: opts.tpm as number | undefined,
    dryRun: Boolean(opts.dryRun),
    verbose: Boolean(opts.verbose),
    zip: Boolean(opts.zip),
    images: opts.images !== false, // commander sets images:false for --no-images
    imageModel: opts.imageModel as string | undefined,
  };

  const cfg = resolveConfig(overrides);
  const model: Model = cfg.dryRun ? new DryModel() : new Cerebras(cfg);

  log.banner("wpforge ⚒  classic WordPress site generator");
  log.info(`prompt:  ${prompt}`);
  log.info(`model:   ${model.model}${cfg.dryRun ? pc.yellow("  (dry-run stub)") : ""}`);

  // Probe the real rate tier up front so the limiter starts accurate.
  let limits = { rpm: cfg.rpm, tpm: cfg.tpm };
  if (!cfg.dryRun && model instanceof Cerebras) {
    limits = await model.probeLimits();
  }
  log.info(`concurrency: ${cfg.concurrency} · rate budget: ${limits.rpm} req/min, ${limits.tpm.toLocaleString()} tok/min`);
  if (!cfg.dryRun && limits.rpm <= 6) {
    log.warn(
      `Low rate tier (${limits.rpm} req/min): a full site is many requests, so this will pace slowly (several minutes). ` +
        `A higher Cerebras tier removes this — then the concurrent fan-out is seconds.`
    );
  }

  const t0 = Date.now();
  const result = await forge(model, cfg, prompt);
  const written = writeForge(result, cfg);
  const wallMs = Date.now() - t0;

  // Summary
  const genTokens = result.metrics.reduce((n, m) => n + m.tokens, 0);
  const failed = result.metrics.filter((m) => !m.ok);
  const wallS = wallMs / 1000;

  log.banner("Done");
  console.log(
    "  " +
      [
        `${pc.bold(String(result.themeFiles.length))} theme files`,
        `${pc.bold(String(result.plugins.length))} plugins`,
        `${pc.bold(String(result.seed.pages.length))} pages`,
        `${pc.bold(String(result.seed.posts.length))} posts`,
        `${pc.bold(String(result.seed.cptItems.length))} custom items`,
      ].join(pc.dim(" · "))
  );
  console.log(
    pc.dim(
      `  ${wallS.toFixed(1)}s wall · ${genTokens.toLocaleString()} tokens generated · ` +
        `~${Math.round(genTokens / Math.max(wallS, 0.001)).toLocaleString()} tok/s effective (concurrency ${cfg.concurrency})`
    )
  );
  if (failed.length) {
    log.warn(`${failed.length} artifact(s) failed and were skipped: ${failed.map((f) => f.label).join(", ")}`);
  }
  log.ok(`output: ${written.outDir}`);
  console.log(pc.dim(`  ${written.fileCount} files · see INSTALL.md`));
  if (written.zipPath) log.ok(`zip: ${written.zipPath}`);
  console.log(pc.dim(`  polish the visuals: `) + pc.bold(`wpforge fix ${written.outDir}`));
}

async function runFixCommand(dir: string, opts: Record<string, unknown>): Promise<void> {
  // The fix pass is Gemini-only (vision diagnoses AND authors the CSS) — no
  // Cerebras key required.
  const cfg = resolveConfig(
    {
      verbose: Boolean(opts.verbose),
      visionModel: opts.visionModel as string | undefined,
      port: opts.port as number | undefined,
      wp: opts.wp as string | undefined,
    },
    { requireCerebrasKey: false }
  );

  log.banner("wpforge ⚒  visual fix pass");
  log.info(`target:  ${dir}`);
  log.info(`eyes + hands: ${cfg.visionModel} (Gemini, multimodal)`);

  const t0 = Date.now();
  const report = await runFix(cfg, dir);
  const wallS = (Date.now() - t0) / 1000;

  log.banner("Done");
  console.log(
    "  " +
      [
        `${pc.bold(String(report.screenshots.length))} surfaces shot`,
        `${pc.bold(String(report.defectsFound))} glaring defects`,
        `${pc.bold(String(report.patchesApplied))} CSS fix pass(es)`,
        `${pc.bold(String(report.remaining))} remaining`,
      ].join(pc.dim(" · "))
  );
  console.log(pc.dim(`  ${wallS.toFixed(1)}s · screenshots in ${dir}/.wpforge-preview/`));
  if (report.patchesApplied > 0) log.ok(`patched: ${report.themeCssPath}`);
  else if (report.defectsFound > 0)
    log.warn(`${report.defectsFound} glaring defect(s) found but no usable CSS fix was produced — see the screenshots.`);
  else log.ok("no glaring defects — nothing to fix");
}

async function runServeCommand(dir: string, opts: Record<string, unknown>): Promise<void> {
  if (!fs.existsSync(path.join(dir, "wp-content"))) {
    throw new Error(`${dir} does not look like a wpforge output (no wp-content/).`);
  }
  // Pure boot — no model calls, so neither API key is required.
  const cfg = resolveConfig(
    { verbose: Boolean(opts.verbose), port: opts.port as number | undefined, wp: opts.wp as string | undefined },
    { requireCerebrasKey: false }
  );

  log.banner("wpforge ⚒  preview server");
  log.info(`serving: ${dir}`);
  const blueprint = ensureBlueprint(dir);
  const server = await startServer(dir, blueprint, { port: cfg.port, wp: cfg.wp, verbose: cfg.verbose });

  log.ok(`WordPress running at ${server.baseUrl}`);
  log.info("Theme + plugins are activated in the right order and the sample content is seeded automatically — nothing to enable by hand.");
  log.info(`Open ${pc.bold(server.baseUrl + "/wp-admin/")} once (you're auto-logged-in) to run the seeder, then browse ${server.baseUrl}.`);
  log.info("Press Ctrl+C to stop.");

  await new Promise<void>((resolve) => {
    const stop = () => {
      server.stop();
      log.info("preview stopped.");
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

async function main() {
  loadDotEnv(process.cwd());

  const program = new Command();
  program
    .name("wpforge")
    .description(
      "Generate a complete classic WordPress site (theme + content model + feature plugins + seeded sample content) from a prompt, using Cerebras + Qwen3-Coder."
    )
    .version("0.2.0");

  program
    .command("generate", { isDefault: true })
    .description("Generate a site from a prompt")
    .argument("[prompt...]", "what site to build, e.g. \"a yoga studio in Berlin with class booking\"")
    .option("-m, --model <id>", "Cerebras model id (default: env CEREBRAS_MODEL or zai-glm-4.7)")
    .option("-c, --concurrency <n>", "max concurrent generations (1-16)", (v) => parseInt(v, 10))
    .option("-o, --output <dir>", "output root directory (default: ./output)")
    .option("--reasoning <effort>", "model reasoning_effort: low | medium | high | off (default: low; design phase runs high)")
    .option("--rpm <n>", "starting requests/minute budget (adapts up from response headers)", (v) => parseInt(v, 10))
    .option("--tpm <n>", "starting tokens/minute budget (adapts up from response headers)", (v) => parseInt(v, 10))
    .option("--zip", "also produce a .zip of wp-content", false)
    .option("--no-images", "skip AI featured-image generation even when GEMINI_API_KEY is set")
    .option("--image-model <id>", "Gemini image model id (default: env WPFORGE_IMAGE_MODEL or gemini-3.1-flash-lite-image)")
    .option("--dry-run", "run the whole pipeline with a stub model (no API key needed)", false)
    .option("-v, --verbose", "verbose error output", false)
    .action(async (words: string[], opts: Record<string, unknown>) => {
      const prompt = (words ?? []).join(" ").trim();
      if (!prompt) {
        log.err('Nothing to build. Try: wpforge "a specialty coffee roaster with a blog"');
        process.exitCode = 1;
        return;
      }
      await runGenerate(prompt, opts);
    });

  program
    .command("serve")
    .description("Boot a generated site in WordPress Playground (theme + plugins auto-activated in order, content seeded) and keep it running — no keys needed")
    .argument("<dir>", "an output directory produced by wpforge (contains wp-content/)")
    .option("--port <n>", "preview port (default 9400; auto-bumps if busy)", (v) => parseInt(v, 10))
    .option("--wp <version>", "WordPress version for the preview (default: latest)")
    .option("-v, --verbose", "stream Playground logs", false)
    .action(async (dir: string, opts: Record<string, unknown>) => {
      await runServeCommand(dir, opts);
    });

  program
    .command("fix")
    .description("Render a generated site in WordPress Playground and fix glaring visual defects with a vision model")
    .argument("<dir>", "an output directory produced by wpforge (contains wp-content/)")
    .option("--vision-model <id>", "vision Gemini model, used for diagnosis AND the CSS fix (default: env WPFORGE_VISION_MODEL or gemini-2.5-flash)")
    .option("--port <n>", "Playground preview port (default 9400)", (v) => parseInt(v, 10))
    .option("--wp <version>", "WordPress version for the preview (default: latest)")
    .option("-v, --verbose", "stream Playground/browser logs", false)
    .action(async (dir: string, opts: Record<string, unknown>) => {
      await runFixCommand(dir, opts);
    });

  program.addHelpText(
    "after",
    `
Examples:
  $ wpforge "a specialty coffee roaster with an online shop and a blog"
  $ wpforge "yoga studio in Berlin, class schedule + booking + contact" --zip
  $ wpforge --dry-run "portfolio site for a product designer"   # no API key
  $ wpforge serve ./output/coffee-roaster                        # boot it in Playground (no keys)
  $ wpforge fix ./output/coffee-roaster                          # render + repair visuals

Setup:
  Put CEREBRAS_API_KEY in a .env file (see .env.example) or export it.
  wpforge fix additionally needs GEMINI_API_KEY (the vision model).
`
  );

  await program.parseAsync();
}

main().catch((err) => {
  log.err((err as Error)?.message ?? String(err));
  if (process.env.WPFORGE_DEBUG) console.error(err);
  process.exit(1);
});
