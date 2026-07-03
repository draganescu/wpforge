# Changelog

All notable changes to wpforge are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.

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
