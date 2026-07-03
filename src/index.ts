#!/usr/bin/env node
// wpforge — generate a complete classic WordPress site from a prompt using
// Cerebras + Qwen3-Coder. Brief → design system → theme + plugins + seeded
// content, fanned out concurrently for speed.
import { Command } from "commander";
import pc from "picocolors";
import { loadDotEnv, resolveConfig, type CliOverrides } from "./config";
import { Cerebras, type Model } from "./cerebras";
import { DryModel } from "./dryModel";
import { forge } from "./pipeline";
import { writeForge } from "./assemble";
import { log } from "./util";

async function main() {
  loadDotEnv(process.cwd());

  const program = new Command();
  program
    .name("wpforge")
    .description(
      "Generate a complete classic WordPress site (theme + content model + feature plugins + seeded sample content) from a prompt, using Cerebras + Qwen3-Coder."
    )
    .version("0.1.0")
    .argument("[prompt...]", "what site to build, e.g. \"a yoga studio in Berlin with class booking\"")
    .option("-m, --model <id>", "Cerebras model id (default: env CEREBRAS_MODEL or qwen-3-coder-480b)")
    .option("-c, --concurrency <n>", "max concurrent generations (1-16)", (v) => parseInt(v, 10))
    .option("-o, --output <dir>", "output root directory (default: ./output)")
    .option("--reasoning <effort>", "model reasoning_effort: low | medium | high | off (default: low, for speed)")
    .option("--rpm <n>", "starting requests/minute budget (adapts up from response headers)", (v) => parseInt(v, 10))
    .option("--tpm <n>", "starting tokens/minute budget (adapts up from response headers)", (v) => parseInt(v, 10))
    .option("--zip", "also produce a .zip of wp-content", false)
    .option("--dry-run", "run the whole pipeline with a stub model (no API key needed)", false)
    .option("-v, --verbose", "verbose error output", false)
    .addHelpText(
      "after",
      `
Examples:
  $ wpforge "a specialty coffee roaster with an online shop and a blog"
  $ wpforge "yoga studio in Berlin, class schedule + booking + contact" --zip
  $ wpforge --dry-run "portfolio site for a product designer"   # no API key

Setup:
  Put CEREBRAS_API_KEY in a .env file (see .env.example) or export it.
`
    );

  program.parse();
  const opts = program.opts();
  const prompt = (program.args ?? []).join(" ").trim();

  if (!prompt) {
    program.help({ error: true });
    return;
  }

  const overrides: CliOverrides = {
    model: opts.model,
    concurrency: opts.concurrency,
    output: opts.output,
    reasoning: opts.reasoning,
    rpm: opts.rpm,
    tpm: opts.tpm,
    dryRun: Boolean(opts.dryRun),
    verbose: Boolean(opts.verbose),
    zip: Boolean(opts.zip),
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
}

main().catch((err) => {
  log.err((err as Error)?.message ?? String(err));
  if (process.env.WPFORGE_DEBUG) console.error(err);
  process.exit(1);
});
