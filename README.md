# wpforge ⚒

Generate a **complete classic WordPress site** from a single prompt — theme, content model, feature plugins, and seeded sample content — using **Cerebras + Qwen3‑Coder** for fast generation.

No blocks. No full‑site‑editing. All classic WordPress (PHP templates + hooks), the way it's meant to be dropped into `wp-content/`.

```bash
wpforge "a neighborhood yoga studio in Berlin with a class schedule, online booking and a small blog"
```

...produces a ready‑to‑install `wp-content/` tree: a bespoke theme, a content‑model plugin (custom post types + fields), the feature plugins the prompt implied (booking, contact form…), and a **seed plugin** that inserts all the sample pages, posts, custom items, the primary menu and the front‑page settings on activation.

## Why Cerebras

For a site generator, wait time is the product. Cerebras serves strong open‑weight coders at very high sustained throughput, so a whole site's worth of PHP/HTML/CSS comes back in seconds. wpforge leans into that by **fanning every independent artifact out concurrently** — all theme files, all plugins, and every piece of sample content generate at once (bounded by `--concurrency`).

Default model is **`zai-glm-4.7`** (GLM‑4.7) — the strongest coder available on most Cerebras accounts (LiveCodeBench ~85%, SWE‑bench Verified ~74%) and the current Cerebras coding model. (Qwen3‑Coder‑480B is not exposed on every account; check yours with `curl -H "Authorization: Bearer $CEREBRAS_API_KEY" https://api.cerebras.ai/v1/models`, then set `-m` / `CEREBRAS_MODEL`.) GLM‑4.7 is a reasoning model, so wpforge defaults `reasoning_effort` to **low** for speed — override with `--reasoning`.

## How it works

The pipeline is sequential only where there's a real data dependency, then maximally parallel:

```
1. Brief      (1 call)   prompt → structured plan: brand, pages, content model, features
2. Design     (1 call)   the make-or-break step: a cohesive visual system realized as the
                         complete theme stylesheet (tokens, layout, components)
        │  (contract derived: fixed class vocabulary + template-tag names)
        ▼
3. Fan-out    (N calls, concurrent, shared limiter)
     ├─ theme files ....... functions.php, header/footer, index, front-page, single,
     │                      archive, search, 404, comments + single-/archive-<cpt>
     ├─ content-model ..... plugin registering CPTs, taxonomies, meta boxes
     ├─ feature plugins ... one per feature (booking, contact form, …), shortcode-driven
     └─ sample content .... every page, every post, every CPT item — each its own call
        ▼
4. Seed       (deterministic)  all content → one idempotent "seed" plugin (base64 JSON payload)
5. Assemble   (deterministic)  write wp-content/ tree + INSTALL.md (+ optional zip)
```

Coherence across the parallel calls comes from a **theme contract**: a fixed CSS class vocabulary (`.container`, `.card`, `.hero`, `.wpforge-form`, …) that the design step styles and every template is restricted to, plus a fixed set of template‑tag functions (`*_placeholder`, `*_post_thumbnail`, `*_posted_on`, `*_entry_footer`) that live in a hand‑written `inc/wpforge-helpers.php` so they always exist and behave identically.

Empty image areas render a **themed vector SVG placeholder** baked with the site's palette — no external services, no broken image icons.

## Setup

```bash
npm install
cp .env.example .env      # add your CEREBRAS_API_KEY (https://cloud.cerebras.ai)
```

## Usage

```bash
# dev (no build needed)
npm run dev -- "a specialty coffee roaster with an online shop and a blog"

# or build once and use the bin
npm run build
node dist/index.js "portfolio site for a product designer" --zip
```

Options:

| flag | meaning |
|------|---------|
| `-m, --model <id>` | Cerebras model id (default `zai-glm-4.7`, or `CEREBRAS_MODEL`) |
| `-c, --concurrency <n>` | max concurrent generations, 1–16 (default 6) |
| `-o, --output <dir>` | output root (default `./output`) |
| `--reasoning <effort>` | `low` \| `medium` \| `high` \| `off` — reasoning_effort (default `low` for speed) |
| `--zip` | also produce a `.zip` of `wp-content` |
| `--dry-run` | run the whole pipeline with a stub model — **no API key needed** (great for hacking on the tool) |
| `-v, --verbose` | verbose error output |

## Self-contained builds

Two ways to ship wpforge without an `npm install` / `node_modules`:

**Single file — needs only Node:**
```bash
npm run bundle                       # → dist/wpforge.cjs  (~950 KB, one file)
node dist/wpforge.cjs "a bakery in Lisbon with online orders"
```
Copy `dist/wpforge.cjs` to any machine with Node ≥ 20 and run it. No install, no `node_modules`, no build step on the target. (esbuild bundles everything, incl. the OpenAI SDK, into that one file.)

**Standalone binary — no runtime at all (via Bun):**
```bash
npm run binary                       # → dist/wpforge  (native binary for this machine)
./dist/wpforge "a bakery in Lisbon with online orders"

npm run binary:linux-x64             # → dist/wpforge-linux-x64
npm run binary:darwin-arm64          # → dist/wpforge-darwin-arm64
```
The binary embeds the runtime (~60 MB), so the target needs **nothing** installed. Requires [Bun](https://bun.sh) to *build* (not to run). Ship these via GitHub Releases, not git — `dist/` is gitignored.

## Output

```
output/<site-slug>/
  wp-content/
    themes/<site-slug>/        the theme (style.css, functions.php, templates, inc/)
    plugins/
      <site>-content-model/    custom post types, taxonomies, meta
      <site>-<feature>/        one per feature (booking, contact-form, …)
      <site>-seed/             inserts all sample content on activation
  INSTALL.md                   copy-in + activation-order instructions
  wpforge-manifest.json        the brief, design tokens, and per-artifact metrics
```

Install order matters (content‑model before seed) — `INSTALL.md` spells it out.

## Notes & caveats

- **Model quality gate.** GLM‑4.7 (and Qwen3‑Coder) is strong at general code; PHP/WordPress‑specific correctness is not separately benchmarked. Review generated plugins before using on a live site. The deterministic parts (seed plugin, helpers, stylesheet header) are hand‑written and PHP‑lint clean.
- **Throughput is workload‑dependent.** Headline tokens/sec are short‑prompt peaks; sustained long‑output generation is lower. Concurrency is what actually collapses wall‑clock here.
- **Rate tier dominates wall‑clock, not model speed.** wpforge reads your account's `x-ratelimit-limit-requests-minute` / `-tokens-minute` from response headers and paces to them automatically (starting conservative, adapting up). On a free/low tier (e.g. **5 req/min, 30k tok/min**) a full site is many requests, so it completes correctly but **slowly — several minutes** (paced to ~4 req/min). On a higher tier the concurrent fan‑out finishes in seconds. Override the starting budget with `--rpm` / `--tpm` (or `CEREBRAS_RPM` / `CEREBRAS_TPM`); it still adapts to the real headers. The binding constraint on low tiers is **request count**, so fewer/bigger requests = faster.
- Pre‑1.0, single‑operator: breaking changes ship cleanly, no back‑compat shims.

## Requirements

Node ≥ 20. Generated sites target WordPress 6.x + PHP 8.1+.

## License

GPL‑2.0‑or‑later — see [LICENSE](LICENSE). Chosen to match the WordPress ecosystem; the themes wpforge generates declare the same license in their `style.css` header.
