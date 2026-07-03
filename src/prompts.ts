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

// ─── Fixed CSS class vocabulary ─────────────────────────────────────────────
// The design step styles ALL of these; the template steps use ONLY these. This
// single shared contract is what keeps independently-generated files coherent.
export const CLASS_VOCAB: Record<string, string> = {
  container: "centered max-width wrapper (~1120px) with horizontal padding",
  "site-header": "top site header bar",
  "site-branding": "logo/title cluster in the header",
  "site-title": "site name (links home)",
  "site-description": "tagline next to/under the title",
  "main-navigation": "primary <nav> menu container",
  "menu-toggle": "mobile hamburger button (hidden on desktop)",
  "nav-menu": "the <ul> of the primary menu",
  "site-content": "main content region wrapper",
  "site-footer": "site footer",
  hero: "full-width hero band on the front page",
  "hero-inner": "constrained hero content",
  "hero-title": "hero headline",
  "hero-subtitle": "hero supporting line",
  section: "vertical content section with generous spacing",
  "section-title": "section heading",
  "section-intro": "short intro paragraph under a section title",
  grid: "responsive auto-fit card grid",
  "grid-2": "two-column grid on desktop",
  "grid-3": "three-column grid on desktop",
  card: "content card surface",
  "card-media": "card image/placeholder area (16:9)",
  "card-body": "card text area",
  "card-title": "card heading",
  "card-meta": "small muted meta line on a card",
  "card-excerpt": "card summary text",
  button: "primary call-to-action button/link",
  "button-secondary": "secondary/ghost button",
  entry: "a single post/page article wrapper",
  "entry-header": "post/page header",
  "entry-title": "post/page title",
  "entry-meta": "post byline/date/taxonomy meta",
  "entry-content": "rendered post/page body",
  "entry-footer": "tags/categories footer of a post",
  "post-thumbnail": "featured-image wrapper (16:9)",
  "page-header": "archive/page banner header",
  "page-title": "archive/page banner title",
  widget: "a sidebar widget",
  "widget-title": "sidebar widget heading",
  "wpforge-form": "styled form wrapper used by feature plugins",
  "form-row": "one label+field row",
  "form-label": "form field label",
  "form-input": "text/email/number input",
  "form-textarea": "textarea",
  "form-select": "select box",
  "form-submit": "form submit button (reuse .button look)",
  "form-notice": "success/error message above a form",
  placeholder: "vector placeholder wrapper for empty image areas",
  pagination: "prev/next posts pagination",
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
- Use ONLY the CSS class names from the provided vocabulary for layout/components — do not invent new structural class names (BEM element/modifier suffixes on these are fine).
- Never call external network services or CDNs except the Google Fonts <link> already enqueued by the theme.`;

function briefContext(brief: Brief): string {
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
${tags}
Available CSS classes (use only these): ${Object.keys(CLASS_VOCAB).join(", ")}`;
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

// ─── 2. Design system (the make-or-break step, split in two) ────────────────
// 2a. Design tokens as small, safe JSON. 2b. The full stylesheet as raw CSS
// text (NOT embedded in JSON — a stylesheet full of braces/quotes/newlines is
// the pathological case for model-emitted JSON).

const ART_DIRECTOR_SYSTEM = `You are an award-winning art director and design engineer — a lead who has shipped identity systems for boutique brands and hand-writes tasteful, production CSS. You have strong, specific taste and a horror of generic "AI website" defaults.

Your non-negotiable standards:
- A restrained, intentional palette (a real background that is NOT pure #fff unless the concept demands it, one confident primary, one accent used sparingly, carefully chosen neutrals). Text/background contrast passes WCAG AA.
- A deliberate Google Fonts pairing that fits the brand's personality (e.g. a characterful display serif + a clean grotesk). Never default to Arial/Times/system-ui as the design.
- A clear modular type scale, an 8px spacing rhythm, generous whitespace, strong typographic hierarchy.
- Components with a point of view: buttons, cards, nav, forms, hero. Subtle, purposeful detail (a considered radius, one tasteful shadow or hairline border, hover transitions) — never decoration for its own sake.
- Fully responsive, mobile-first, including a working mobile nav toggle.
- Anti-slop: avoid default-Bootstrap blue, center-everything layouts, heavy drop shadows everywhere, purple gradients, emoji, and clip-art. Aim for editorial, confident, brand-specific design.`;

export function designTokensPrompt(brief: Brief): { system: string; user: string } {
  const user = `${briefContext(brief)}

Decide the visual direction and return JSON with EXACTLY this shape (no extra keys):
{
  "artDirection": string,     // one vivid paragraph: concept, mood, references, why these choices
  "vibe": string[],           // 4-6 adjectives
  "palette": {
    "bg": hex, "surface": hex, "text": hex, "muted": hex,
    "primary": hex, "primaryContrast": hex, "accent": hex, "border": hex
  },
  "headingFont": { "family": string, "fallback": string, "weights": number[] },
  "bodyFont": { "family": string, "fallback": string, "weights": number[] },
  "radius": { "sm": string, "md": string, "lg": string, "pill": string }
}

Font families MUST be real Google Fonts. Hex colors only for the palette. Return only the JSON.`;
  return { system: ART_DIRECTOR_SYSTEM, user };
}

export function stylesheetPrompt(
  brief: Brief,
  tokens: DesignSystem
): { system: string; user: string } {
  const system = `${ART_DIRECTOR_SYSTEM}

You are now writing the COMPLETE stylesheet that realizes an already-decided design direction. Output ONLY raw CSS — no markdown, no code fences, no JSON, no commentary. Do NOT include the WordPress "/*! Theme Name ... */" header comment or any @import (fonts load via <link>).`;

  const p = tokens.palette;
  const vocab = Object.entries(CLASS_VOCAB)
    .map(([k, v]) => `  .${k} — ${v}`)
    .join("\n");

  const user = `${briefContext(brief)}

DECIDED DIRECTION (realize this exactly — do not invent a different palette or fonts):
Art direction: ${tokens.artDirection}
Palette: bg ${p.bg}, surface ${p.surface}, text ${p.text}, muted ${p.muted}, primary ${p.primary}, primaryContrast ${p.primaryContrast}, accent ${p.accent}, border ${p.border}
Heading font: "${tokens.headingFont.family}" (${tokens.headingFont.fallback}); Body font: "${tokens.bodyFont.family}" (${tokens.bodyFont.fallback})
Radius scale: sm ${tokens.radius.sm}, md ${tokens.radius.md}, lg ${tokens.radius.lg}, pill ${tokens.radius.pill}

Write the complete stylesheet:
1. A ":root" block with CSS custom properties for every palette color, both font stacks, the radius scale, a spacing scale (--space-1 … --space-8 on an 8px base), a max content width, and 1-2 shadow tokens. Reference these vars throughout.
2. A small modern reset + base element styles (html/body, links, headings in the heading font with a modular scale, paragraphs, lists, responsive images, blockquote, code, tables, hr).
3. Layout + component styles for EVERY class in this vocabulary (all styled and coherent):
${vocab}
4. Mobile-first responsive rules with a ~768px breakpoint: .main-navigation collapses behind .menu-toggle on mobile and shows inline on desktop; .grid/.grid-2/.grid-3 reflow to one column.
5. Classic WordPress content states: .wp-caption, .alignleft/.alignright/.aligncenter, .sticky, .gallery, and comment-list basics.
6. Interaction polish: :focus-visible outlines using the accent color, hover transitions on links/buttons/cards.

Output the raw CSS now.`;
  return { system, user };
}

// ─── 3. Theme files ─────────────────────────────────────────────────────────
export interface ThemeFileSpec {
  path: string;
  label: string;
  purpose: string;
  extra?: string;
}

/** The set of theme files to generate (functions.php + templates). Archive/single
 *  templates for custom post types are appended dynamically from the brief. */
export function themeFileSpecs(brief: Brief): ThemeFileSpec[] {
  const specs: ThemeFileSpec[] = [
    {
      path: "functions.php",
      label: "functions.php",
      purpose:
        "Theme bootstrap. Requires inc/wpforge-helpers.php. Registers theme supports (title-tag, post-thumbnails, custom-logo, html5, automatic-feed-links, menus), registers the primary nav menu location and a sidebar/widget area (ids from the contract), enqueues the Google Fonts <link> and the theme stylesheet (style.css, versioned with filemtime), adds image sizes for cards (16:9), and sets content width. Do NOT redefine the helper template tags — they live in inc/wpforge-helpers.php.",
    },
    {
      path: "header.php",
      label: "header.php",
      purpose:
        "Opening <!doctype html> through the opening of .site-content. Includes <?php wp_head(); ?>, language_attributes, charset, viewport, .site-header with .site-branding (custom-logo or site-title+description) and the primary .main-navigation (wp_nav_menu with the contract menu location, a .menu-toggle button, and a graceful fallback).",
    },
    {
      path: "footer.php",
      label: "footer.php",
      purpose:
        "Closes .site-content, renders .site-footer (site title, a short colophon, current year, and wp_nav_menu fallback or a simple credit), then wp_footer() and closing tags.",
    },
    {
      path: "sidebar.php",
      label: "sidebar.php",
      purpose:
        "Renders the registered sidebar via dynamic_sidebar() wrapped so widgets use .widget/.widget-title. Bail if the sidebar is inactive.",
    },
    {
      path: "index.php",
      label: "index.php",
      purpose:
        "The fallback loop. get_header(); a .page-header when appropriate; the posts loop rendering each post as a .card (or .entry on single-column) using wpforge_post_thumbnail(), title linking to permalink, .card-meta with wpforge_posted_on(), and the excerpt; the_posts_pagination() as .pagination; get_footer().",
    },
    {
      path: "front-page.php",
      label: "front-page.php",
      purpose:
        "The homepage. get_header(); a strong .hero (site name/tagline + a .button CTA to the main action page); then 2-4 .section blocks that showcase the site's value — e.g. featured items from the primary custom post type (query it) rendered in a .grid of .card, an about teaser, and a call-to-action. Use wpforge_post_thumbnail() for imagery. get_footer(). Make it feel designed, not a bare list.",
    },
    {
      path: "page.php",
      label: "page.php",
      purpose:
        "Single page template. get_header(); .entry with .entry-header/.entry-title, .entry-content via the_content(); comments if open; get_footer().",
    },
    {
      path: "single.php",
      label: "single.php",
      purpose:
        "Single blog post. get_header(); .entry with .post-thumbnail (wpforge_post_thumbnail), .entry-header (title + .entry-meta via wpforge_posted_on), .entry-content, .entry-footer via wpforge_entry_footer(); post navigation; comments_template(); get_footer().",
    },
    {
      path: "archive.php",
      label: "archive.php",
      purpose:
        "Generic archive/blog index. get_header(); .page-header with the_archive_title/description; a .grid of post .card items; pagination; get_footer().",
    },
    {
      path: "search.php",
      label: "search.php",
      purpose:
        "Search results. get_header(); .page-header showing the query and result count; results as .card items or a friendly no-results message with get_search_form(); pagination; get_footer().",
    },
    {
      path: "404.php",
      label: "404.php",
      purpose:
        "Friendly 404. get_header(); .page-header; helpful copy; get_search_form(); a .button back home; get_footer().",
    },
    {
      path: "comments.php",
      label: "comments.php",
      purpose:
        "Standard classic comments template: bail on password-protected; list comments with wp_list_comments (avatar, .comment-meta), the_comments_navigation, and comment_form(). Keep markup clean and styled by the theme.",
    },
    {
      path: "searchform.php",
      label: "searchform.php",
      purpose:
        "A custom search form using role=search, a labelled .form-input and a .button submit, escaping the action and value.",
    },
  ];

  for (const pt of brief.postTypes) {
    specs.push({
      path: `archive-${pt.key}.php`,
      label: `archive-${pt.key}.php`,
      purpose: `Archive for the "${pt.labelPlural}" custom post type (${pt.key}). get_header(); a .page-header titled "${pt.labelPlural}"; a .grid of .card items showing thumbnail, title, and the most relevant custom fields; pagination; get_footer().`,
      extra: cptFieldsHint(pt),
    });
    specs.push({
      path: `single-${pt.key}.php`,
      label: `single-${pt.key}.php`,
      purpose: `Single "${pt.labelSingular}" (${pt.key}). get_header(); .entry with .post-thumbnail, title, and a clean presentation of the custom fields (read with get_post_meta) alongside .entry-content; related items or a back-to-archive .button; get_footer().`,
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
  const system = `You are a meticulous WordPress theme developer writing one file of a classic theme. You write clean, secure, correctly-escaped PHP that matches the provided design system and honors the theme contract exactly. ${CODE_RULES}`;

  const user = `${briefContext(brief)}

${designContext(design)}

${contractContext(contract)}

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

Requirements: proper plugin header comment; guard direct access (if (!defined('ABSPATH')) exit;); prefix everything; correct labels; register_post_type args include 'has_archive', 'rewrite' with the slug, 'menu_icon', 'supports'. Meta boxes must use nonces and sanitize on save (sanitize_text_field / esc_url_raw / floatval by field type). Output ONLY the PHP file.`;
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

Return JSON: { "title": string, "slug": "${page.slug}", "excerpt": string, "content": string }
- "content" is clean HTML using <h2>/<h3>/<p>/<ul>/<blockquote>/<a> — NO block comments, NO inline styles, NO <script>. Structure it well (intro, a few sections, a closing CTA). Reasonable length (250-500 words) and genuinely about THIS business.
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
Return JSON: { "title": "${topic.title}", "slug": string, "excerpt": string, "content": string, "categories": ["${topic.category}"], "tags": ${JSON.stringify(topic.tags)} }
- "content": clean HTML (<h2>/<h3>/<p>/<ul>/<blockquote>), 400-700 words, useful and on-brand. No block comments, no scripts, no inline styles.
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
  "terms": { ${tax || "/* no taxonomies */"} }
}
Fill every meta field with a realistic value (numbers as numbers). Only JSON.`,
  };
}
