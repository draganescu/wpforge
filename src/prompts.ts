// Every prompt the pipeline sends. Kept in one file so the shared voice and the
// hard rules (classic WP, no blocks, escaping, the fixed class vocabulary) stay
// consistent across all the parallel generations.
import type {
  Brief,
  BriefFeature,
  BriefPostType,
  DesignSystem,
  ThemeContract,
} from "./types";

// ─── Fixed functional class core ────────────────────────────────────────────
// These class names are PLUMBING: they are emitted by the theme's hand-written
// PHP helpers (inc/wpforge-helpers.php), the feature plugins, the nav-toggle and
// motion scripts, and the deterministic CSS backstops. They must ALWAYS exist
// and behave identically, so they are fixed — the design step is free to style
// them however it likes, but it MUST style all of them and templates may always
// use them. Everything ELSE (hero, cards, sections, article layout…) is invented
// per-site as the design's own vocabulary — see DesignSpec.vocabulary.
export const CORE_VOCAB: Record<string, string> = {
  // Layout + chrome the header/footer/sidebar templates emit
  container: "centered max-width wrapper with horizontal padding",
  "site-header": "top site header bar",
  "site-branding": "logo/title cluster in the header",
  "site-title": "site name (links home)",
  "site-description": "tagline next to/under the title",
  "main-navigation": "primary <nav> menu container",
  "menu-toggle": "mobile hamburger button (hidden on desktop)",
  "nav-menu": "the <ul> of the primary menu",
  "toggled-on": "state class the nav script adds to reveal the mobile menu",
  "site-content": "main content region wrapper",
  "site-footer": "site footer",
  widget: "a sidebar widget",
  "widget-title": "sidebar widget heading",
  // Buttons — every CTA and every plugin form submit reuses these
  button: "primary call-to-action button/link",
  "button-secondary": "secondary/ghost button",
  // Emitted by inc/wpforge-helpers.php template tags — style these exactly
  "post-thumbnail": "featured-image wrapper printed by the post-thumbnail helper",
  "thumb-img": "the <img> inside a featured-image wrapper",
  placeholder: "vector placeholder wrapper printed for empty image areas",
  "placeholder-svg": "the inline <svg> inside a placeholder",
  "entry-meta": "post date/author meta printed by the posted-on helper",
  "entry-date": "the <time> inside entry-meta",
  byline: "the author span inside entry-meta",
  "entry-footer": "categories/tags footer printed by the entry-footer helper",
  "cat-links": "category links inside entry-footer",
  "tags-links": "tag links inside entry-footer",
  pagination: "prev/next posts pagination",
  // Feature-plugin form surface (plugins depend on these class names)
  "wpforge-form": "styled form wrapper used by feature plugins",
  "form-row": "one label+field row",
  "form-label": "form field label",
  "form-input": "text/email/number input",
  "form-textarea": "textarea",
  "form-select": "select box",
  "form-submit": "form submit button (reuse the .button look)",
  "form-notice": "success/error message above a form",
  // Motion contract: templates add .reveal to any block that should animate in;
  // the theme's motion script adds .is-visible when it enters the viewport.
  reveal: "opt a block into the scroll-reveal motion (theme reveals it into view)",
  "is-visible": "state the motion script sets on a .reveal once revealed",
  // Accessibility
  "screen-reader-text": "visually hidden, screen-reader only",
};

// ─── Shared hard rules for all code generation ──────────────────────────────
export const CODE_RULES = `HARD RULES (follow exactly):
- Output ONLY the raw file contents. No markdown, no code fences, no explanation before or after.
- Target CLASSIC WordPress (PHP templates + hooks). This is NOT a block theme: do NOT emit block markup (<!-- wp:* -->), theme.json, block.json, or any React/JSX. No full-site-editing.
- Assume PHP 8.1+ and WordPress 6.x.
- Follow WordPress coding standards. Escape ALL output (esc_html, esc_attr, esc_url, wp_kses_post). Sanitize ALL input. Use nonces + capability checks for any form or write.
- Internationalize user-facing strings with the given text domain.
- Prefix all global functions to avoid collisions.
- Never pass a PHP built-in function name as a string callback to WordPress APIs ('sanitize_callback' => 'floatval', add_filter with 'intval', …). WordPress invokes callbacks with extra arguments and PHP 8 fatals internal functions given extra args. Use a WordPress sanitizer (sanitize_text_field, absint) or wrap it: static function ( $value ) { return floatval( $value ); }.
- Use ONLY the CSS class names from the provided vocabulary for layout/components — do not invent new structural class names (BEM element/modifier suffixes on these are fine).
- Never call external network services or CDNs except the Google Fonts <link> already enqueued by the theme.`;

export function briefContext(brief: Brief): string {
  return `SITE BRIEF
Name: ${brief.siteName}
Tagline: ${brief.tagline}
Description: ${brief.description}
Industry: ${brief.industry}
Audience: ${brief.audience}
Design keywords: ${brief.designKeywords.join(", ")}`;
}

function designContext(design: DesignSystem): string {
  const p = design.palette;
  return `DESIGN SYSTEM (already realized in the theme's style.css — match it, do not restyle)
Art direction: ${design.artDirection}
Fonts: headings "${design.headingFont.family}" (${design.headingFont.fallback}); body "${design.bodyFont.family}" (${design.bodyFont.fallback})
Palette: bg ${p.bg}, surface ${p.surface}, text ${p.text}, muted ${p.muted}, primary ${p.primary}, primaryContrast ${p.primaryContrast}, accent ${p.accent}, border ${p.border}
Radius: ${design.radius.md}. Buttons use .button / .button-secondary.`;
}

/** The class vocabulary a template is allowed to use, one per line with its
 *  role, so the model builds markup the stylesheet actually styles. */
function classListContext(design: DesignSystem): string {
  const lines = Object.entries(design.classes)
    .map(([k, v]) => `  .${k} — ${v}`)
    .join("\n");
  return `ALLOWED CSS CLASSES (use ONLY these for structure/components; the stylesheet styles exactly these — inventing new structural class names leaves them unstyled). BEM-style element/modifier suffixes on them (e.g. .card__title, .hero--split) are fine:
${lines}`;
}

function contractContext(contract: ThemeContract): string {
  const tags = contract.templateTags
    .map((t) => `  ${t.signature} — ${t.description}`)
    .join("\n");
  return `THEME CONTRACT (fixed shared surface — honor exactly)
Text domain: ${contract.textDomain}
Theme slug (function/handle prefix uses this with hyphens→underscores): ${contract.themeSlug}
Nav menu location: ${contract.menuLocation}
Sidebar id: ${contract.sidebarId}
Google Fonts <link> href to enqueue: ${contract.googleFontsHref}
These template-tag functions are ALREADY defined in inc/wpforge-helpers.php — CALL them, never redefine:
${tags}`;
}

// ─── 1. Brief / plan ────────────────────────────────────────────────────────
export function briefPrompt(userPrompt: string): { system: string; user: string } {
  const system = `You are a senior WordPress solutions architect and content strategist. You turn a short site idea into a precise, buildable plan for a CLASSIC (non-block) WordPress site. You are decisive and opinionated: you invent a real brand name, sensible pages, a proper content model, and exactly the feature plugins the idea implies (e.g. a booking idea → a booking plugin; "get in touch" → a contact-form plugin). You never over-engineer.`;

  const user = `Site idea from the user:
"""
${userPrompt}
"""

Produce a JSON plan with EXACTLY this shape (no extra keys):
{
  "siteName": string,                // invent a fitting brand name if none given
  "tagline": string,                 // short, memorable
  "description": string,             // 1-2 sentences
  "industry": string,
  "audience": string,
  "designKeywords": string[],        // 4-7 aesthetic/mood words to drive visual design
  "languageCode": "en_US",
  "primaryMenuName": "Primary",
  "pages": [                         // 4-7 pages; include a home page and a contact page
    { "title": string, "slug": string, "purpose": string, "template"?: "front-page"|"contact"|null, "navOrder"?: number }
  ],
  "postTypes": [                     // 0-3 custom post types the idea needs (omit if a blog is enough)
    {
      "key": string,                 // lowercase, underscores, <=20 chars, singular (e.g. "class", "menu_item")
      "labelSingular": string,
      "labelPlural": string,
      "description": string,
      "hasArchive": true,
      "supports": ["title","editor","thumbnail","excerpt"],
      "menuIcon": string,            // a dashicons-* slug
      "fields": [ { "name": string, "label": string, "type": "text"|"textarea"|"number"|"url"|"date"|"email"|"image" } ],
      "taxonomies": [ { "key": string, "label": string, "hierarchical": boolean, "terms": string[] } ],
      "sampleCount": number          // 3-6
    }
  ],
  "features": [                      // the plugins to generate; each is a real, shortcode-driven classic plugin
    { "key": string, "name": string, "description": string, "shortcode": string, "onPage"?: string }
  ],
  "blogPostCount": number            // 3-5 (0 only if a blog truly makes no sense)
}

Rules: slugs are lowercase-hyphenated. Always include a contact-form feature unless the idea explicitly excludes it. Pick post types that genuinely fit (a restaurant → menu_item; a yoga studio → class + instructor; a portfolio → project). Keep it lean and realistic.

Name features by their FUNCTION with generic slugs/names — "contact-form", "booking", "gallery", "newsletter", "testimonials", "menu", "events". NEVER name a feature after an existing commercial/third-party plugin or trademark (no "Contact Form 7", "Bookly", "Envira Gallery", "WooCommerce", "Yoast", etc.) — these are original plugins built from scratch.`;
  return { system, user };
}

// ─── 2. Design system ───────────────────────────────────────────────────────
// The whole design phase (shootout → judge → spec → stylesheet → motion →
// critique → revise) lives in prompts-design.ts. It produces a DesignSystem
// whose `classes`, `layouts` and `styleCss` the steps below are generated
// against. Nothing design-authoring lives in this file anymore.

// ─── 3. Theme files ─────────────────────────────────────────────────────────
/** Which composition surface a template draws from in the design's layout plan.
 *  "chrome" templates (header/footer/etc.) have no composition — just function. */
export type Surface = "front-page" | "archive" | "single" | "page" | "detail" | "chrome";

export interface ThemeFileSpec {
  path: string;
  label: string;
  purpose: string;
  /** the design layout surface this template executes */
  surface: Surface;
  extra?: string;
}

/** The set of theme files to generate (functions.php + templates). Archive/single
 *  templates for custom post types are appended dynamically from the brief. */
export function themeFileSpecs(brief: Brief): ThemeFileSpec[] {
  const specs: ThemeFileSpec[] = [
    {
      path: "functions.php",
      label: "functions.php",
      surface: "chrome",
      purpose:
        "Theme bootstrap. Requires inc/wpforge-helpers.php. Registers theme supports (title-tag, post-thumbnails, custom-logo, html5, automatic-feed-links, menus), registers the primary nav menu location and a sidebar/widget area (ids from the contract), enqueues the Google Fonts <link> and the theme stylesheet (style.css, versioned with filemtime), adds a 16:9 image size for featured thumbnails, and sets content width. Do NOT redefine the helper template tags — they live in inc/wpforge-helpers.php.",
    },
    {
      path: "header.php",
      label: "header.php",
      surface: "chrome",
      purpose:
        "Opening <!doctype html> through the opening of .site-content. Includes <?php wp_head(); ?>, language_attributes, charset, viewport, .site-header with .site-branding (custom-logo or site-title+description) and the primary .main-navigation: a .menu-toggle button, then wp_nav_menu with EXACTLY these args — 'theme_location' from the contract, 'menu_id' => 'primary-menu', 'menu_class' => 'nav-menu', 'container' => false — so .nav-menu is the <ul> itself (the stylesheet depends on that), with a graceful fallback.",
    },
    {
      path: "footer.php",
      label: "footer.php",
      surface: "chrome",
      purpose:
        "Closes .site-content, renders .site-footer (site title, a short colophon, current year, and wp_nav_menu fallback or a simple credit), then wp_footer() and closing tags.",
    },
    {
      path: "sidebar.php",
      label: "sidebar.php",
      surface: "chrome",
      purpose:
        "Renders the registered sidebar via dynamic_sidebar() wrapped so widgets use .widget/.widget-title. Bail if the sidebar is inactive.",
    },
    {
      path: "index.php",
      label: "index.php",
      surface: "archive",
      purpose:
        "The fallback blog/list loop. get_header(); the posts loop rendering each post's title (linking to permalink), wpforge_post_thumbnail(), wpforge_posted_on() and the excerpt; the_posts_pagination() inside a .pagination wrapper; get_footer(). Compose it exactly as the ARCHIVE layout below dictates.",
    },
    {
      path: "front-page.php",
      label: "front-page.php",
      surface: "front-page",
      purpose:
        "The homepage — the most designed template. get_header(); build the composition in the FRONT-PAGE layout below, section by section, in order. Pull real data where the layout calls for it (e.g. WP_Query the primary custom post type or recent posts for a featured strip) and use wpforge_post_thumbnail() for imagery. get_footer(). This must feel art-directed, not a bare list.",
    },
    {
      path: "page.php",
      label: "page.php",
      surface: "page",
      purpose:
        "Single static page. get_header(); render the page title and the_content(); comments if open; get_footer(). Compose per the PAGE layout below.",
    },
    {
      path: "single.php",
      label: "single.php",
      surface: "single",
      purpose:
        "Single blog post. get_header(); render wpforge_post_thumbnail(), the title, wpforge_posted_on(), the_content(), wpforge_entry_footer(); post navigation; comments_template(); get_footer(). Compose per the SINGLE layout below.",
    },
    {
      path: "archive.php",
      label: "archive.php",
      surface: "archive",
      purpose:
        "Generic archive/blog index. get_header(); a header showing the_archive_title/the_archive_description; the posts loop as list items (thumbnail, title, meta, excerpt); pagination; get_footer(). Compose per the ARCHIVE layout below.",
    },
    {
      path: "search.php",
      label: "search.php",
      surface: "archive",
      purpose:
        "Search results. get_header(); a header showing the query and result count; results as list items or a friendly no-results message with get_search_form(); pagination; get_footer(). Compose the results per the ARCHIVE layout below.",
    },
    {
      path: "404.php",
      label: "404.php",
      surface: "page",
      purpose:
        "Friendly 404. get_header(); a header, helpful copy, get_search_form() and a .button back home; get_footer(). Compose per the PAGE layout below (a lean variant is fine).",
    },
    {
      path: "comments.php",
      label: "comments.php",
      surface: "chrome",
      purpose:
        "Standard classic comments template: bail on password-protected; list comments with wp_list_comments (avatar, .comment-meta), the_comments_navigation, and comment_form(). Keep markup clean and styled by the theme.",
    },
    {
      path: "searchform.php",
      label: "searchform.php",
      surface: "chrome",
      purpose:
        "A custom search form using role=search, a labelled .form-input and a .button submit, escaping the action and value.",
    },
  ];

  for (const pt of brief.postTypes) {
    specs.push({
      path: `archive-${pt.key}.php`,
      label: `archive-${pt.key}.php`,
      surface: "archive",
      purpose: `Archive for the "${pt.labelPlural}" custom post type (${pt.key}). get_header(); a header titled "${pt.labelPlural}"; the loop as list items showing wpforge_post_thumbnail(), the title, and the most relevant custom fields; pagination; get_footer(). Compose per the ARCHIVE layout below.`,
      extra: cptFieldsHint(pt),
    });
    specs.push({
      path: `single-${pt.key}.php`,
      label: `single-${pt.key}.php`,
      surface: "detail",
      purpose: `Single "${pt.labelSingular}" (${pt.key}). get_header(); render wpforge_post_thumbnail(), the title, a clean presentation of the custom fields (read with get_post_meta) alongside the_content(), and a back-to-archive .button; get_footer(). Compose per the DETAIL layout below.`,
      extra: cptFieldsHint(pt),
    });
  }

  return specs;
}

function cptFieldsHint(pt: BriefPostType): string {
  const fields = pt.fields
    .map((f) => `${f.name} (${f.type}, "${f.label}")`)
    .join(", ");
  const tax = pt.taxonomies.map((t) => `${t.key} ("${t.label}")`).join(", ");
  return `Custom fields stored as post meta (meta_key = field name): ${fields || "none"}. Taxonomies: ${tax || "none"}. Read meta with get_post_meta($id, 'name', true) and escape per field type (esc_url for url, esc_html otherwise; treat "image" meta as an attachment URL and render inside .post-thumbnail, falling back to wpforge_placeholder()).`;
}

export function themeFilePrompt(
  spec: ThemeFileSpec,
  brief: Brief,
  design: DesignSystem,
  contract: ThemeContract
): { system: string; user: string } {
  const system = `You are a meticulous WordPress theme developer writing one file of a classic theme. You write clean, secure, correctly-escaped PHP that matches the provided design system and honors the theme contract exactly. You build the exact layout the art director composed — you do not simplify it into a generic template. ${CODE_RULES}`;

  const layout =
    spec.surface !== "chrome" && design.layouts?.[spec.surface]
      ? `\n${spec.surface.toUpperCase()} LAYOUT (the art director's composition for this surface — build the markup that realizes it, in this order, using the classes below):\n${design.layouts[spec.surface]}\n\nAdd the class "reveal" to the section-level blocks that should animate into view (the theme's motion script reveals them). Keep it purposeful — not every element.\n`
      : "";

  const user = `${briefContext(brief)}

${designContext(design)}

${contractContext(contract)}

${classListContext(design)}
${layout}
Write the file: ${spec.path}
Purpose: ${spec.purpose}${spec.extra ? "\n" + spec.extra : ""}

Output ONLY the complete contents of ${spec.path}.`;
  return { system, user };
}

// ─── 4. Content-model plugin (CPTs, taxonomies, meta) ───────────────────────
export function contentModelPrompt(
  brief: Brief,
  contract: ThemeContract
): { system: string; user: string } {
  const system = `You are a WordPress plugin developer. You write a single-file classic plugin that registers a site's content model so it survives theme switches. ${CODE_RULES}`;

  const model = brief.postTypes
    .map((pt) => {
      const fields = pt.fields
        .map((f) => `    - ${f.name}: ${f.type} ("${f.label}")`)
        .join("\n");
      const tax = pt.taxonomies
        .map(
          (t) =>
            `    - ${t.key}: ${t.hierarchical ? "hierarchical (category-like)" : "flat (tag-like)"} ("${t.label}"), sample terms: ${t.terms.join(", ")}`
        )
        .join("\n");
      return `Post type "${pt.key}" (${pt.labelSingular}/${pt.labelPlural}) icon ${pt.menuIcon || "dashicons-admin-post"}, has_archive true, supports ${pt.supports.join("/")}, public, show_in_rest false.
  Fields (register_post_meta, string/number, single, auth callback current_user_can 'edit_posts', and a simple meta box on the edit screen to edit them):
${fields || "    - none"}
  Taxonomies (register + attach to this post type):
${tax || "    - none"}`;
    })
    .join("\n\n");

  const user = `${briefContext(brief)}

Write a single-file WordPress plugin "${contract.themeSlug}-content-model" (text domain "${contract.textDomain}") that registers this content model on the 'init' hook and flushes rewrite rules on activation/deactivation:

${model || "No custom post types — register nothing but still output a valid, safe empty plugin with the header."}

Requirements: proper plugin header comment; guard direct access (if (!defined('ABSPATH')) exit;); prefix everything; correct labels; register_post_type args include 'has_archive', 'rewrite' with the slug, 'menu_icon', 'supports'. Meta boxes must use nonces and sanitize on save (sanitize_text_field / esc_url_raw / (float) cast by field type). register_post_meta 'sanitize_callback' must be a WordPress sanitizer or an inline closure — never a quoted PHP built-in like 'floatval' (WordPress passes the filter 4 arguments; PHP 8 fatals). Output ONLY the PHP file.`;
  return { system, user };
}

// ─── 5. Feature plugins (booking, contact form, …) ──────────────────────────
export function featurePluginPrompt(
  feature: BriefFeature,
  brief: Brief,
  contract: ThemeContract
): { system: string; user: string } {
  const system = `You are a senior WordPress plugin developer. You build small, self-contained, secure classic plugins that expose their UI via a shortcode (no blocks). ${CODE_RULES}`;

  const user = `${briefContext(brief)}

Build a single-file WordPress plugin for this feature:
Name: ${feature.name}
Slug: ${contract.themeSlug}-${feature.key}
Text domain: ${contract.textDomain}
Shortcode: [${feature.shortcode}]
What it must do: ${feature.description}

Requirements:
- Proper plugin header; guard direct access; prefix all functions/options with a slug-derived prefix.
- Register the shortcode [${feature.shortcode}] that renders the feature's front-end UI. Any form uses method="post", a wp_nonce_field, .wpforge-form markup with .form-row/.form-label/.form-input/.form-textarea and a .button submit, and shows a .form-notice on success/error.
- Handle submissions securely on 'init' or admin-post (verify nonce, check capabilities where relevant, sanitize every field, escape every output). Persist data sensibly: store submissions/bookings in a dedicated custom post type registered by THIS plugin (e.g. "${feature.key}_entry", show in admin only), and/or email the site admin via wp_mail. Never trust input.
- If the feature implies admin management (e.g. viewing bookings/messages), register the CPT with an admin menu so the owner can read entries.
- Enqueue only minimal inline CSS if strictly needed; rely on the theme's .wpforge-form styles otherwise.
- Keep it to ONE PHP file, complete and working.

Output ONLY the PHP file.`;
  return { system, user };
}

// ─── 6. Sample content ──────────────────────────────────────────────────────
export function blogTopicsPrompt(brief: Brief): { system: string; user: string } {
  return {
    system:
      "You are a content editor. You propose specific, on-brand blog post ideas — concrete and useful, never generic filler.",
    user: `${briefContext(brief)}

Propose ${brief.blogPostCount} distinct blog post ideas for this site. Return JSON:
{ "categories": string[] (2-4 blog categories), "posts": [ { "title": string, "category": string, "tags": string[], "angle": string (one line on what the post covers) } ] }
Only JSON.`,
  };
}

export function cptTitlesPrompt(
  pt: BriefPostType,
  brief: Brief
): { system: string; user: string } {
  return {
    system:
      "You are a content editor creating realistic sample catalog entries for a website demo. Specific and believable, not lorem ipsum.",
    user: `${briefContext(brief)}

Invent ${pt.sampleCount} distinct, realistic "${pt.labelSingular}" entries for this site. Return JSON:
{ "items": [ { "title": string, "angle": string (one line) } ] }
Only JSON.`,
  };
}

export function pageContentPrompt(
  page: { title: string; slug: string; purpose: string },
  brief: Brief,
  features: BriefFeature[]
): { system: string; user: string } {
  const shortcodes = features
    .filter((f) => f.onPage === page.slug)
    .map((f) => `[${f.shortcode}]`)
    .join(" ");
  const scNote = shortcodes
    ? `\nThis page should embed these feature shortcodes where they belong: ${shortcodes}. Include the shortcode(s) verbatim in the content.`
    : "";
  return {
    system:
      "You are a senior website copywriter. You write specific, confident, benefit-led copy in clean semantic HTML for the classic WordPress editor. No lorem ipsum, no block markup.",
    user: `${briefContext(brief)}

Write the content for the "${page.title}" page (purpose: ${page.purpose}).${scNote}

Return JSON: { "title": string, "slug": "${page.slug}", "excerpt": string, "content": string, "image": { "prompt": string, "alt": string } }
- "content" is clean HTML using <h2>/<h3>/<p>/<ul>/<blockquote>/<a> — NO block comments, NO inline styles, NO <script>. Structure it well (intro, a few sections, a closing CTA). Reasonable length (250-500 words) and genuinely about THIS business.
- "image.prompt": describe the ideal featured photograph for THIS page's content — concrete subject, setting, composition, time of day. It should depict what the page is about, not a generic stock scene. No style/aesthetic words (applied separately), no text in the image, no brand names.
- "image.alt": one concise sentence describing that photo for screen readers.
Only JSON.`,
  };
}

export function postContentPrompt(
  topic: { title: string; category: string; tags: string[]; angle: string },
  brief: Brief
): { system: string; user: string } {
  return {
    system:
      "You are an expert blogger for this brand. You write engaging, specific, well-structured posts in clean HTML (classic editor). No filler, no block markup.",
    user: `${briefContext(brief)}

Write the blog post titled "${topic.title}" (${topic.angle}).
Return JSON: { "title": "${topic.title}", "slug": string, "excerpt": string, "content": string, "categories": ["${topic.category}"], "tags": ${JSON.stringify(topic.tags)}, "image": { "prompt": string, "alt": string } }
- "content": clean HTML (<h2>/<h3>/<p>/<ul>/<blockquote>), 400-700 words, useful and on-brand. No block comments, no scripts, no inline styles.
- "image.prompt": the ideal featured photograph for THIS post — concrete subject, setting, composition, tied to what the post actually says. No style words, no text in the image, no brand names.
- "image.alt": one concise sentence describing that photo for screen readers.
Only JSON.`,
  };
}

export function cptItemPrompt(
  pt: BriefPostType,
  item: { title: string; angle: string },
  brief: Brief
): { system: string; user: string } {
  const fields = pt.fields
    .map((f) => `"${f.name}": ${f.type === "number" ? "number" : "string"} (${f.label})`)
    .join(", ");
  const tax = pt.taxonomies
    .map((t) => `"${t.key}": string[] (choose from: ${t.terms.join(", ")})`)
    .join(", ");
  return {
    system:
      "You create realistic, specific sample catalog entries with believable details. Never lorem ipsum.",
    user: `${briefContext(brief)}

Create the "${pt.labelSingular}" entry "${item.title}" (${item.angle}).
Return JSON:
{
  "title": "${item.title}",
  "slug": string,
  "excerpt": string,               // one enticing sentence
  "content": string,               // 2-4 short HTML paragraphs (<p>), classic editor, no blocks
  "meta": { ${fields || "/* no fields */"} },
  "terms": { ${tax || "/* no taxonomies */"} },
  "image": { "prompt": string, "alt": string }  // the ideal featured photo for THIS entry: concrete subject/setting/composition drawn from its details; no style words, no text in image, no brand names; alt = one sentence for screen readers
}
Fill every meta field with a realistic value (numbers as numbers). Only JSON.`,
  };
}
