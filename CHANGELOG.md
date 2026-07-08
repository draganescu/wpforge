# Changelog

All notable changes to wpforge are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.

## [Unreleased]

### Changed
- **Art-director-grade design phase.** The design step is now a quality pipeline run at high reasoning instead of a single token+CSS pass: a 3-way **direction shootout** (each concept generated through a different design lens — editorial, brutalist, quiet-luxury, swiss, art-house…), a **judge** that scores them and picks a winner with notes, a full **design spec**, then the **stylesheet + motion script** (concurrent), then an adversarial **critique + one revise pass**. Only the design calls run at `reasoning_effort=high`; the fan-out stays low. `--reasoning off` still disables reasoning everywhere.
- **Free-form, per-site class vocabulary + composed layouts.** The old fixed 66-class skeleton (same hero + card grid on every site) is replaced by a small **fixed functional core** (plumbing the helpers/plugins/scripts depend on) plus a **class vocabulary the design invents per site**. The same step authors a **per-surface layout composition** (front-page / archive / single / page / detail) that each template executes, so one mind lays out the whole site with intentional rhythm instead of 15 parallel writers each guessing.

### Added
- **Bespoke presentational motion.** The design phase generates a per-site scroll-reveal / entrance script, inlined by the theme helpers. Safe by construction: the CSS hides a `.reveal` only under `html.js`, the helpers enable that class and a reveal failsafe only when a valid script ships, and `prefers-reduced-motion` is honored — a no-JS visitor, a dropped script, or reduced motion all still see every element.
- **Deterministic design gates** (`designGuards.ts`, unit-tested): the stylesheet is brace-balanced / minimum-size / `:root`-checked (killing the truncated 22-line degenerate output, with one retry); the motion script is syntax-parsed, forbidden-token-scanned (no network / `eval` / script-breakout) and size-capped — invalid motion is dropped rather than shipped. After the fan-out, a class-coverage lint styles any class a template used that the stylesheet omitted.

## [0.2.0] - 2026-07-04

### Added
- AI featured images via Google Gemini (Nano Banana family, default `gemini-3.1-flash-lite-image`). The content model describes each page/post/item's ideal photo in context while writing the copy; the design system's art direction is composed on top so every image on the site shares one look. Images ship inside the seeder plugin and are sideloaded into the media library (with alt text) as featured images on activation — idempotent, like all seeding. Enable by setting `GEMINI_API_KEY`; without it, themed SVG placeholders render as before. New flags: `--no-images`, `--image-model <id>`.
- Test suite (`npm test`, node test runner via tsx) covering the deterministic generator hardening.
- Self-contained build targets: `npm run bundle` (single-file dist/wpforge.cjs) and `npm run binary` (standalone Bun binary, plus linux-x64/darwin-arm64 cross-targets).

### Fixed
- Generated content-model plugins could white-screen the site on PHP 8 when a bare PHP built-in (e.g. `'floatval'`) was used as a `register_post_meta` sanitize callback — WordPress passes 4 filter args and PHP internals fatal on extra args. Generated PHP is now hardened deterministically (callbacks wrapped in single-arg closures) and the prompts forbid the pattern.
- Feature-plugin shortcodes could silently land on no page when the brief's `onPage` slug drifted from the generated page slug ("book-a-dive" vs "book-dive"), leaving e.g. a booking form plugin active but invisible. Page references are now fuzzy-resolved at brief normalization, and a placement backstop appends any still-missing shortcode to its intended page before seeding.
- The primary menu rendered as an unstyled bullet list: the stylesheet treats `.nav-menu` as the menu `<ul>` (per the shared class vocabulary) but header.php emitted it as a wrapper div. The wp_nav_menu args are now pinned in the prompt, repaired deterministically when a model drifts, and a menu-list CSS reset backstop ships in every stylesheet. The mobile menu toggle button, previously dead (no JS shipped), now works via a small toggler emitted from the deterministic theme helpers.

## [0.1.0] - 2026-07-03

### Added
- Initial release: generate a complete classic WordPress site (theme, content-model plugin, feature plugins, seeded sample content, menu, front page) from a single prompt via Cerebras + GLM/Qwen.
