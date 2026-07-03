// Runtime configuration, resolved from env + CLI flags.
import fs from "node:fs";
import path from "node:path";

export interface Config {
  apiKey: string;
  baseUrl: string;
  model: string;
  concurrency: number;
  outputRoot: string;
  temperatureCode: number;
  temperatureCreative: number;
  /** reasoning_effort passed to the model ("low"|"medium"|"high"), or "off" to omit */
  reasoningEffort: string;
  /** starting request/minute + token/minute budget; adapts up from response headers */
  rpm: number;
  tpm: number;
  dryRun: boolean;
  verbose: boolean;
  zip: boolean;
}

/** Minimal .env loader (no dependency). Only sets keys not already in env. */
export function loadDotEnv(cwd = process.cwd()): void {
  const p = path.join(cwd, ".env");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export interface CliOverrides {
  model?: string;
  concurrency?: number;
  output?: string;
  reasoning?: string;
  rpm?: number;
  tpm?: number;
  dryRun?: boolean;
  verbose?: boolean;
  zip?: boolean;
}

export function resolveConfig(overrides: CliOverrides): Config {
  const dryRun = overrides.dryRun ?? false;
  const apiKey = process.env.CEREBRAS_API_KEY ?? "";
  if (!apiKey && !dryRun) {
    throw new Error(
      "CEREBRAS_API_KEY is not set. Add it to .env (see .env.example) or export it. " +
        "Use --dry-run to exercise the pipeline without calling the API."
    );
  }
  const concurrency =
    overrides.concurrency ??
    (Number(process.env.WPFORGE_CONCURRENCY ?? "6") || 6);

  return {
    apiKey,
    baseUrl: process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
    model: overrides.model ?? process.env.CEREBRAS_MODEL ?? "zai-glm-4.7",
    concurrency: Math.max(1, Math.min(concurrency, 16)),
    outputRoot: path.resolve(overrides.output ?? "output"),
    temperatureCode: 0.3,
    temperatureCreative: 0.7,
    reasoningEffort: overrides.reasoning ?? process.env.CEREBRAS_REASONING_EFFORT ?? "low",
    rpm: overrides.rpm ?? (Number(process.env.CEREBRAS_RPM ?? "5") || 5),
    tpm: overrides.tpm ?? (Number(process.env.CEREBRAS_TPM ?? "30000") || 30000),
    dryRun,
    verbose: overrides.verbose ?? false,
    zip: overrides.zip ?? false,
  };
}
