# wpforge ⚒

Generate a **complete classic WordPress site** from a single prompt — theme, content model, feature plugins, and seeded sample content — using **Cerebras + Qwen3‑Coder** for fast generation, with optional **AI featured images via Google Gemini** (Nano Banana 2 Lite).

No blocks. No full‑site‑editing. All classic WordPress (PHP templates + hooks), the way it's meant to be dropped into `wp-content/`.

```bash
wpforge "a neighborhood yoga studio in Berlin with a class schedule, online booking and a small blog"
```

...produces a ready‑to‑install `wp-content/` tree: a bespoke theme, a content‑model plugin (custom post types + fields), the feature plugins the prompt implied (booking, contact form…), and a **seed plugin** that inserts all the sample pages, posts, custom items, the primary menu and the front‑page settings on activation — including **AI‑generated featured images** (Google Gemini / Nano Banana) when a `GEMINI_API_KEY` is set.

## Why Cerebras

For a site generator, wait time is the product. Cerebras serves strong open‑weight coders at very high sustained throughput, so a whole site's worth of PHP/HTML/CSS comes back in seconds. wpforge leans into that by **fanning every independent artifact out concurrently** — all theme files, all plugins, and every piece of sample content generate at once (bounded by `--concurrency`).

Default model is **`zai-glm-4.7`** (GLM‑4.7) — the strongest coder available on most Cerebras accounts (LiveCodeBench ~85%, SWE‑bench Verified ~74%) and the current Cerebras coding model. (Qwen3‑Coder‑480B is not exposed on every account; check yours with `curl -H "Authorization: Bearer $CEREBRAS_API_KEY" https://api.cerebras.ai/v1/models`, then set `-m` / `CEREBRAS_MODEL`.) GLM‑4.7 is a reasoning model, so wpforge defaults `reasoning_effort` to **low** for speed — override with `--reasoning`. The **design phase alone runs at high reasoning** (taste is where thinking pays off); the fan‑out stays low. Set `--reasoning off` to disable reasoning everywhere, design included.

## How it works

The pipeline is sequential only where there's a real data dependency, then maximally parallel:

```
1. Brief      (1 call)   prompt → structured plan: brand, pages, content model, features
2. Design     (~9 calls, high reasoning)   the make-or-break step, run as a quality pipeline:
     ├─ shootout ....... 3 competing directions, each through a different design lens (concurrent)
     ├─ judge .......... scores them, picks the winner, writes notes to push it further
     ├─ spec ........... realizes the winner: tokens + the site's OWN class vocabulary +
     │                   a per-surface layout composition + a motion plan
     ├─ stylesheet ..... the complete CSS realizing the spec         ─┐ concurrent, each gated
     ├─ motion ......... a bespoke presentational-motion script       ─┘ (CSS: braces/size/coverage;
     │                                                                     JS: syntax/forbidden-token)
     └─ critique+revise  an adversarial read (typography, rhythm, slop, contrast) → one fix pass
        │  (contract derived: the generated class vocabulary + layouts + template-tag names)
        ▼
3. Fan-out    (N calls, concurrent, shared limiter)
     ├─ theme files ....... functions.php, header/footer, index, front-page, single,
     │                      archive, search, 404, comments + single-/archive-<cpt>
     ├─ content-model ..... plugin registering CPTs, taxonomies, meta boxes
     ├─ feature plugins ... one per feature (booking, contact form, …), shortcode-driven
     └─ sample content .... every page, every post, every CPT item — each its own call,
                            each also describing its ideal featured photo in context
        ▼
4. Images     (N calls, concurrent, optional)  each content item's in-context image spec
                            + the design system's art direction → Gemini (Nano Banana 2
                            Lite) → featured JPEGs. Skipped without GEMINI_API_KEY.
5. Seed       (deterministic)  all content + images → one idempotent "seed" plugin
                            (base64 JSON payload; images bundled as plugin assets and
                            sideloaded into the media library on activation)
6. Assemble   (deterministic)  write wp-content/ tree + INSTALL.md (+ optional zip)
```

Coherence across the parallel calls comes from a **theme contract**. A small **fixed functional core** of class names is plumbing that the hand‑written helpers, feature plugins and scripts all depend on (`.container`, `.wpforge-form`, `.post-thumbnail`, `.nav-menu`, `.reveal`, …) — the design styles these but never renames them. Everything visual beyond that (heroes, bands, cards, editorial columns) is a **class vocabulary the design step invents per site**, and the same step composes a **per‑surface layout plan** so one mind lays out the whole site; every template executes its plan against the generated vocabulary. Template‑tag functions (`*_placeholder`, `*_post_thumbnail`, `*_posted_on`, `*_entry_footer`) live in a hand‑written `inc/wpforge-helpers.php` so they always exist and behave identically. After the fan‑out, a deterministic lint styles any class a template used that the stylesheet missed.

**Presentational motion** ships as a bespoke, per‑site script the design phase generates, validated deterministically (syntax‑parsed, forbidden‑token‑scanned, size‑capped) before it's inlined by the helpers. The reveal contract is safe by construction: the CSS hides a `.reveal` block only under `html.js`, the helpers add that class (and a reveal failsafe) only when a valid script ships, and `prefers-reduced-motion` is honored — so a no‑JS visitor, a dropped script, or a reduced‑motion setting all still see every element.

With a `GEMINI_API_KEY` set, every page, post and custom item gets a **real featured image**: the content model describes what the photo should show *while writing that item's copy* (subject, setting, composition), and the design step's art direction is composed on top so all images share one aesthetic. The images ride inside the seed plugin and are attached (with alt text) on activation. Without a key — or with `--no-images` — empty image areas render a **themed vector SVG placeholder** baked with the site's palette instead: no external services, no broken image icons. The placeholder also remains the fallback for any image that fails to generate.

## Setup

```bash
npm install
cp .env.example .env      # add your CEREBRAS_API_KEY (https://cloud.cerebras.ai)
                          # optional: GEMINI_API_KEY (https://aistudio.google.com)
                          #           → AI featured images on every page/post/item
```

Image generation needs a Gemini key from a project with billing enabled (free-tier keys have no image-model quota). At Nano Banana 2 Lite pricing (~$0.034 per 1K image) a full site's ~15 images cost about $0.50.

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
| `--no-images` | skip AI featured images even when `GEMINI_API_KEY` is set |
| `--image-model <id>` | Gemini image model (default `gemini-3.1-flash-lite-image`, or `WPFORGE_IMAGE_MODEL`) |
| `--zip` | also produce a `.zip` of `wp-content` |
| `--dry-run` | run the whole pipeline with a stub model — **no API key needed** (great for hacking on the tool) |
| `-v, --verbose` | verbose error output |

## `wpforge fix` — a vision-driven visual repair pass

The coder model writes CSS blind — it never sees the rendered page. `wpforge fix` hands the whole repair to a **Gemini vision model** that both sees the defects and writes the fix: it boots the generated site, screenshots it, and repairs glaring visual bugs. It needs only `GEMINI_API_KEY` (no Cerebras).

```bash
wpforge fix ./output/lady-factory        # needs GEMINI_API_KEY
```

What it does:

1. **Boots the site** in [WordPress Playground](https://wordpress.github.io/wordpress-playground/) (PHP-WASM + SQLite, no local WP needed) using the `wpforge-preview-blueprint.json` saved next to every output — activates the theme + plugins in order and seeds the sample content.
2. **Screenshots one page per template surface** with headless Chromium (front page desktop + mobile, archive, single, page, search, 404, and each custom post type's archive + single) — reveal-motion forced to its resting state, admin bar hidden.
3. **Diagnoses each screenshot** — GLARING, objective, CSS-fixable defects only (unreadable/low-contrast text, overflow, overlap, unstyled blocks). Taste and "missing content" are out of scope.
4. **Authors a CSS override patch multimodally**: the same Gemini model is shown the broken screenshots *together with* the current `style.css`, so it sees each defect and finds the exact selector responsible, then writes minimal overrides appended to `style.css`. Because the theme is live-mounted, a reload on the same (still-seeded) server serves the patched CSS, so it **re-screenshots and re-diagnoses to verify** — up to two passes.

Fixes are **CSS-only** (one file, safe to patch and re-verify); templates/PHP are out of scope by design. Screenshots land in `<output>/.wpforge-preview/` as before/after evidence. First run downloads Chrome for Testing (~150 MB) and WordPress core (cached afterwards).

| flag | meaning |
|------|---------|
| `--vision-model <id>` | Gemini model used for diagnosis AND the CSS fix (default `gemini-2.5-flash`, or `WPFORGE_VISION_MODEL`) |
| `--port <n>` | Playground preview port (default 9400; auto-bumps if busy) |
| `--wp <version>` | WordPress version for the preview (default: latest) |
| `-v, --verbose` | stream Playground/browser logs |

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
        assets/images/         generated featured images (when image gen ran)
  INSTALL.md                   copy-in + activation-order instructions
  wpforge-manifest.json        the brief, design tokens, and per-artifact metrics
```

Install order matters (content‑model before seed) — `INSTALL.md` spells it out.

## Notes & caveats

- **Model quality gate.** GLM‑4.7 (and Qwen3‑Coder) is strong at general code; PHP/WordPress‑specific correctness is not separately benchmarked. Review generated plugins before using on a live site. The deterministic parts (seed plugin, helpers, stylesheet header) are hand‑written and PHP‑lint clean.
- **Throughput is workload‑dependent.** Headline tokens/sec are short‑prompt peaks; sustained long‑output generation is lower. Concurrency is what actually collapses wall‑clock here.
- **Images are fast, cheap, and watermarked.** Featured images generate in ~4–6 s each and run at the pipeline's full concurrency, so the image phase adds well under a minute. Gemini‑generated images carry Google's invisible SynthID watermark — fine for demo/sample content, worth knowing before using them as production imagery. A failed image never fails the build; the item just keeps its SVG placeholder.
- **Rate tier dominates wall‑clock, not model speed.** wpforge reads your account's `x-ratelimit-limit-requests-minute` / `-tokens-minute` from response headers and paces to them automatically (starting conservative, adapting up). On a free/low tier (e.g. **5 req/min, 30k tok/min**) a full site is many requests, so it completes correctly but **slowly — several minutes** (paced to ~4 req/min). On a higher tier the concurrent fan‑out finishes in seconds. Override the starting budget with `--rpm` / `--tpm` (or `CEREBRAS_RPM` / `CEREBRAS_TPM`); it still adapts to the real headers. The binding constraint on low tiers is **request count**, so fewer/bigger requests = faster.
- Pre‑1.0, single‑operator: breaking changes ship cleanly, no back‑compat shims.

## Requirements

Node ≥ 20. Generated sites target WordPress 6.x + PHP 8.1+.

## License

GPL‑2.0‑or‑later — see [LICENSE](LICENSE). Chosen to match the WordPress ecosystem; the themes wpforge generates declare the same license in their `style.css` header.
