// Adaptive rate limiter. Cerebras returns the account's real limits on every
// response (x-ratelimit-limit-requests-minute / -tokens-minute) — so we start
// conservative, then adapt to whatever the tier actually allows. Paces on BOTH
// requests/minute and tokens/minute, since a low tier (e.g. 5 RPM / 30k TPM)
// binds on either. Acquisitions are serialized into an orderly queue.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RateLimits {
  rpm: number;
  tpm: number;
}

export class RateLimiter {
  private rpm: number;
  private tpm: number;
  private tokens: number; // token bucket (per-minute)
  private lastRefill: number;
  private reqTimes: number[] = []; // request start times within the last 60s
  private chain: Promise<void> = Promise.resolve();
  private readonly safety: number;

  constructor(limits: RateLimits, safety = 0.85) {
    this.rpm = Math.max(1, limits.rpm);
    this.tpm = Math.max(1000, limits.tpm);
    this.safety = safety;
    this.tokens = this.tpm * safety;
    this.lastRefill = Date.now();
  }

  get limits(): RateLimits {
    return { rpm: this.rpm, tpm: this.tpm };
  }

  private refill(): void {
    const t = Date.now();
    const dt = (t - this.lastRefill) / 1000;
    if (dt > 0) {
      this.tokens = Math.min(this.tpm * this.safety, this.tokens + this.tpm * (dt / 60));
      this.lastRefill = t;
    }
    this.reqTimes = this.reqTimes.filter((x) => t - x < 60000);
  }

  /** Reserve a request + estimated tokens, waiting until both fit the budget. */
  async acquire(estTokens: number): Promise<void> {
    const run = this.chain.then(() => this.doAcquire(estTokens));
    this.chain = run.catch(() => {});
    return run;
  }

  private async doAcquire(estTokens: number): Promise<void> {
    const capReq = Math.max(1, Math.floor(this.rpm * this.safety));
    for (;;) {
      this.refill();
      const est = Math.min(estTokens, this.tpm * this.safety);
      const reqOk = this.reqTimes.length < capReq;
      const tokOk = this.tokens >= est;
      if (reqOk && tokOk) {
        this.tokens -= est;
        this.reqTimes.push(Date.now());
        return;
      }
      let wait = 200;
      if (!reqOk && this.reqTimes.length) {
        wait = Math.max(wait, this.reqTimes[0] + 60000 - Date.now() + 25);
      }
      if (!tokOk) {
        const need = est - this.tokens;
        wait = Math.max(wait, Math.ceil((need / (this.tpm / 60)) * 1000));
      }
      await sleep(Math.min(Math.max(wait, 100), 5000));
    }
  }

  /** Return unused reservation once the real token cost is known. */
  credit(estTokens: number, actualTokens: number): void {
    const back = Math.max(0, Math.min(estTokens, this.tpm * this.safety) - actualTokens);
    if (back > 0) this.tokens = Math.min(this.tpm * this.safety, this.tokens + back);
  }

  /** Adapt to the account's real limits from response headers. */
  updateFromHeaders(get: (k: string) => string | null | undefined): void {
    const num = (k: string) => {
      const v = get(k);
      const n = v == null ? NaN : Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const lr = num("x-ratelimit-limit-requests-minute");
    if (lr) this.rpm = Math.max(1, lr);
    const lt = num("x-ratelimit-limit-tokens-minute");
    if (lt) this.tpm = Math.max(1000, lt);
    // Sync the token bucket down to the server's view if it's stricter.
    const rt = num("x-ratelimit-remaining-tokens-minute");
    if (rt !== undefined) this.tokens = Math.min(this.tokens, rt);
    // Reflect server-side used requests in our window.
    const rr = num("x-ratelimit-remaining-requests-minute");
    if (rr !== undefined) {
      const used = Math.max(0, Math.floor(this.rpm) - rr);
      const now = Date.now();
      while (this.reqTimes.length < used) this.reqTimes.push(now);
    }
  }
}
