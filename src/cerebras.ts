// Cerebras inference client (OpenAI-compatible). One thin wrapper the whole
// pipeline shares. Handles retries/backoff, per-call timing + token accounting,
// and two convenience calls: `chat` (free text, e.g. a PHP file) and `chatJSON`
// (structured output, parsed defensively).
import OpenAI from "openai";
import type { Config } from "./config";
import { extractJson, stripCodeFence, estimateTokens } from "./util";
import { RateLimiter } from "./ratelimit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CallOpts {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** per-call reasoning_effort override ("low"|"medium"|"high"|"off"); falls
   *  back to the config default. The design phase runs "high"; the rest "low". */
  reasoningEffort?: string;
  /** for logging/metrics only */
  label?: string;
}

export interface CallResult {
  text: string;
  ms: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** "stop" | "length" | ... — "length" means the output was truncated */
  finishReason?: string;
}

/** Shared surface implemented by the real client and the dry-run stub. */
export interface Model {
  readonly model: string;
  chat(prompt: string, opts?: CallOpts): Promise<CallResult>;
  chatJSON<T>(prompt: string, opts?: CallOpts): Promise<{ data: T } & CallResult>;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

export class Cerebras {
  private client: OpenAI;
  private cfg: Config;
  private limiter: RateLimiter;
  /** flipped true if a model rejects reasoning_effort, so we stop sending it */
  private reasoningDisabled = false;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.limiter = new RateLimiter({ rpm: cfg.rpm, tpm: cfg.tpm });
    this.client = new OpenAI({
      apiKey: cfg.apiKey || "dry-run",
      baseURL: cfg.baseUrl,
      maxRetries: 0, // we do our own retry so we can backoff + log
      timeout: 120_000,
    });
  }

  /** current (possibly header-adapted) rate limits, for logging */
  get rateLimits() {
    return this.limiter.limits;
  }

  /** One tiny call up front to learn the account's real limits from the
   *  response headers, so the limiter starts at the true tier (no ramp) and
   *  startup output is accurate. Falls back to defaults on any error. */
  async probeLimits(): Promise<{ rpm: number; tpm: number }> {
    try {
      const { response } = await this.client.chat.completions
        .create({
          model: this.cfg.model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
          stream: false,
        } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
        .withResponse();
      this.limiter.updateFromHeaders((k) => response.headers.get(k));
    } catch {
      /* keep conservative defaults */
    }
    return this.limiter.limits;
  }

  /** The reasoning_effort to send for a call, or null to omit it. A per-call
   *  override (opts.reasoningEffort) wins over the config default. */
  private effortFor(opts: CallOpts): string | null {
    if (this.reasoningDisabled) return null;
    const e = opts.reasoningEffort ?? this.cfg.reasoningEffort;
    return e && e !== "off" ? e : null;
  }

  get model() {
    return this.cfg.model;
  }

  private async once(prompt: string, opts: CallOpts): Promise<CallResult> {
    const t0 = Date.now();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: prompt });

    const maxTokens = opts.maxTokens ?? 8000;
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: opts.temperature ?? this.cfg.temperatureCode,
      max_tokens: maxTokens,
      stream: false,
    };
    const effort = this.effortFor(opts);
    if (effort) body.reasoning_effort = effort;

    // Pace against the account's RPM/TPM budget before firing. High reasoning
    // spends more thinking tokens, so reserve more headroom for it.
    const est =
      estimateTokens((opts.system ?? "") + prompt) +
      Math.round(maxTokens * 0.5) +
      (effort ? (effort === "high" ? 3000 : 1500) : 0);
    await this.limiter.acquire(est);

    const { data: resp, response } = await this.client.chat.completions
      .create(body as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
      .withResponse();

    // Learn the real limits + reconcile the token budget from the headers.
    this.limiter.updateFromHeaders((k) => response.headers.get(k));
    const usage = (resp as OpenAI.Chat.ChatCompletion).usage;
    this.limiter.credit(est, usage?.total_tokens ?? est);

    const choice = (resp as OpenAI.Chat.ChatCompletion).choices?.[0];
    const text = choice?.message?.content ?? "";
    return {
      text,
      ms: Date.now() - t0,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? estimateTokens(text),
      totalTokens: usage?.total_tokens ?? estimateTokens(prompt + text),
      finishReason: choice?.finish_reason ?? undefined,
    };
  }

  /** Call with retry/backoff on transient errors (incl. 429 rate limits). */
  async call(prompt: string, opts: CallOpts = {}): Promise<CallResult> {
    const maxAttempts = 6;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.once(prompt, opts);
      } catch (err: unknown) {
        lastErr = err;
        const status =
          (err as { status?: number })?.status ??
          (err as { response?: { status?: number } })?.response?.status;
        const msg = (err as Error)?.message ?? "";
        // If the model rejects reasoning_effort, stop sending it and retry now.
        if (status === 400 && !this.reasoningDisabled && /reason/i.test(msg)) {
          this.reasoningDisabled = true;
          continue;
        }
        const retryable = status === undefined || RETRYABLE.has(status);
        if (attempt === maxAttempts || !retryable) break;

        let backoff: number;
        if (status === 429) {
          // Rate limited: honor Retry-After, else wait out a chunk of the minute.
          const hdrs = (err as { headers?: Record<string, string> }).headers ?? {};
          const ra = Number(hdrs["retry-after"]);
          backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 + 250 : Math.min(15000, 5000 * attempt);
        } else {
          backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
        }
        const jitter = Math.floor(backoff * 0.2 * Math.random());
        await sleep(backoff + jitter);
      }
    }
    const label = opts.label ? ` [${opts.label}]` : "";
    throw new Error(
      `Cerebras call failed${label}: ${(lastErr as Error)?.message ?? String(lastErr)}`
    );
  }

  /** Free-text generation (returns fence-stripped content). */
  async chat(prompt: string, opts: CallOpts = {}): Promise<CallResult> {
    const r = await this.call(prompt, opts);
    return { ...r, text: stripCodeFence(r.text) };
  }

  /** Structured generation: parse the first JSON value out of the response. */
  async chatJSON<T>(prompt: string, opts: CallOpts = {}): Promise<{ data: T } & CallResult> {
    const jsonSystem =
      (opts.system ? opts.system + "\n\n" : "") +
      "Respond with a single valid JSON value only. No markdown, no code fences, no commentary before or after.";
    const r = await this.call(prompt, { ...opts, system: jsonSystem });
    try {
      const data = extractJson<T>(r.text);
      return { data, ...r };
    } catch (e) {
      // If the output was truncated (reasoning ate the budget), re-run the same
      // prompt with more room before falling back to a text repair.
      if (r.finishReason === "length") {
        const bigger = await this.call(prompt, {
          ...opts,
          system: jsonSystem,
          maxTokens: Math.min((opts.maxTokens ?? 8000) * 2, 24000),
        });
        try {
          return { data: extractJson<T>(bigger.text), ...bigger };
        } catch {
          /* fall through to text repair */
        }
      }
      // one repair attempt: hand the bad output back and ask for strict JSON
      const repair = await this.call(
        "The following was supposed to be a single valid JSON value but could not be parsed. " +
          "Return ONLY the corrected, valid JSON value — no commentary, no code fences:\n\n" +
          r.text,
        { ...opts, system: jsonSystem, temperature: 0 }
      );
      const data = extractJson<T>(repair.text);
      return {
        data,
        text: repair.text,
        ms: r.ms + repair.ms,
        promptTokens: r.promptTokens + repair.promptTokens,
        completionTokens: r.completionTokens + repair.completionTokens,
        totalTokens: r.totalTokens + repair.totalTokens,
      };
    }
  }
}
