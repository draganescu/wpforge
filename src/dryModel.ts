// Offline stub implementing the Model interface. Returns shape-valid canned
// output keyed off the call's `label`, so `--dry-run` exercises the entire
// pipeline (fan-out, seeding, assembly, file writing) with no API key.
import type { CallOpts, CallResult, Model } from "./cerebras";
import { estimateTokens } from "./util";

function result(text: string, ms = 12): CallResult {
  const t = estimateTokens(text);
  return { text, ms, promptTokens: 200, completionTokens: t, totalTokens: 200 + t };
}

const DRY_BRIEF = {
  siteName: "Larkspur Yoga",
  tagline: "Breathe. Move. Belong.",
  description: "A neighborhood yoga studio offering classes for every body, plus easy online booking.",
  industry: "Wellness / Yoga studio",
  audience: "Local adults seeking calm, community and movement",
  designKeywords: ["calm", "earthy", "editorial", "airy", "grounded", "warm"],
  languageCode: "en_US",
  primaryMenuName: "Primary",
  pages: [
    { title: "Home", slug: "home", purpose: "Welcome + overview + CTA to book", template: "front-page", navOrder: 1 },
    { title: "Classes", slug: "classes", purpose: "Overview of class styles", navOrder: 2 },
    { title: "About", slug: "about", purpose: "Studio story and teachers", navOrder: 3 },
    { title: "Contact", slug: "contact", purpose: "Reach us + contact form", template: "contact", navOrder: 4 },
  ],
  postTypes: [
    {
      key: "class",
      labelSingular: "Class",
      labelPlural: "Classes",
      description: "A yoga class offered at the studio",
      hasArchive: true,
      supports: ["title", "editor", "thumbnail", "excerpt"],
      menuIcon: "dashicons-universal-access",
      fields: [
        { name: "level", label: "Level", type: "text" },
        { name: "duration", label: "Duration (min)", type: "number" },
        { name: "teacher", label: "Teacher", type: "text" },
      ],
      taxonomies: [
        { key: "class_style", label: "Style", hierarchical: true, terms: ["Vinyasa", "Yin", "Restorative"] },
      ],
      sampleCount: 3,
    },
  ],
  features: [
    { key: "contact-form", name: "Contact Form", description: "A simple contact form that emails the studio.", shortcode: "larkspur_contact_form", onPage: "contact" },
    { key: "booking", name: "Class Booking", description: "Let visitors request a spot in a class.", shortcode: "larkspur_booking", onPage: "classes" },
  ],
  blogPostCount: 3,
};

const DRY_PALETTE = {
  bg: "#f6f2ea",
  surface: "#fffdf8",
  text: "#20261f",
  muted: "#6f6a5f",
  primary: "#4b5d43",
  primaryContrast: "#ffffff",
  accent: "#c9a25a",
  border: "#e6e0d3",
  invertBg: "#20261f",
  invertText: "#f6f2ea",
};

const DRY_CONCEPT = {
  lens: "organic humanist",
  thesis:
    "Warm, grounded and editorial: a sand-paper ground, ink-dark text, a sage primary and a soft ochre accent, with an oversized serif masthead.",
  palette: DRY_PALETTE,
  headingFont: "Fraunces",
  bodyFont: "Inter",
  heroArchetype: "Full-bleed split hero, oversized serif left, image bleeding off the right.",
  layoutRhythm: "Asymmetric editorial sections alternating with an inverted stats band.",
  motionConcept: "Sections rise and fade into view, staggered gently.",
  signatureDetail: "A hairline rule + numbered section index.",
};

const DRY_SPEC = {
  concept: DRY_CONCEPT.thesis,
  vibe: ["calm", "earthy", "editorial", "warm"],
  palette: DRY_PALETTE,
  headingFont: { family: "Fraunces", fallback: "Georgia, serif", weights: [400, 600] },
  bodyFont: { family: "Inter", fallback: "system-ui, sans-serif", weights: [400, 600] },
  typeScale: "Body 1.05rem; h1 clamp(2.5rem, 6vw, 4.5rem); ratio 1.333.",
  radius: { sm: "6px", md: "12px", lg: "20px", pill: "999px" },
  motion: {
    concept: "Calm, staggered entrances as content scrolls in.",
    reveals: "Each .reveal section fades and rises 24px, staggered within its group.",
  },
  vocabulary: [
    { name: "page-section", role: "vertical content section with generous spacing" },
    { name: "hero-split", role: "front-page split hero" },
    { name: "feature-band", role: "inverted full-bleed band" },
    { name: "list-item", role: "archive/list entry" },
    { name: "article-body", role: "single post/page body wrapper" },
    { name: "eyebrow", role: "small kicker label above a heading" },
  ],
  layouts: {
    "front-page":
      "1) hero-split (container, oversized title, .button CTA, reveal); 2) feature-band inverted stats (reveal); 3) page-section with a list of list-item cards (reveal); 4) page-section CTA.",
    archive: "page-section header (eyebrow + title), then a column of list-item entries, then pagination.",
    single: "hero-split-lite header (post-thumbnail, title, entry-meta), then article-body, then entry-footer.",
    page: "page-section with eyebrow + title + article-body.",
    detail: "hero-split header (post-thumbnail + title), then article-body with the fields, then a back .button.",
  },
};

// A full, gate-passing dry stylesheet (styles the core classes + the DRY_SPEC
// vocabulary + the .reveal html.js motion contract). Kept realistic so a
// --dry-run exercises the happy path through the deterministic CSS gate.
const DRY_STYLE_CSS = `:root{--color-bg:#f6f2ea;--color-surface:#fffdf8;--color-text:#20261f;--color-muted:#6f6a5f;--color-primary:#4b5d43;--color-primary-contrast:#fff;--color-accent:#c9a25a;--color-border:#e6e0d3;--color-invert-bg:#20261f;--color-invert-text:#f6f2ea;--font-head:'Fraunces',Georgia,serif;--font-body:'Inter',system-ui,sans-serif;--radius-md:12px;--radius-pill:999px;--space-2:8px;--space-3:16px;--space-4:24px;--space-6:48px;--space-8:80px;--maxw:1120px;--shadow:0 8px 30px rgba(32,38,31,.08)}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--color-bg);color:var(--color-text);font-family:var(--font-body);line-height:1.6}
h1,h2,h3{font-family:var(--font-head);line-height:1.1;letter-spacing:-.01em}
h1{font-size:clamp(2.5rem,6vw,4.5rem)}
h2{font-size:clamp(1.8rem,3.5vw,2.75rem)}
a{color:var(--color-primary);text-decoration:none}
a:hover{color:var(--color-accent)}
img{max-width:100%;height:auto;display:block}
blockquote{margin:0;padding:var(--space-4);border-left:3px solid var(--color-accent);font-style:italic}
.container{max-width:var(--maxw);margin:0 auto;padding:0 var(--space-4)}
.site-header{border-bottom:1px solid var(--color-border);padding:var(--space-3) 0;position:sticky;top:0;background:var(--color-bg);z-index:20}
.site-branding{display:flex;flex-direction:column}
.site-title{font-family:var(--font-head);font-size:1.4rem}
.site-description{color:var(--color-muted);font-size:.85rem}
.main-navigation{display:flex;align-items:center;gap:var(--space-4)}
.menu-toggle{display:none;border:1px solid var(--color-border);background:none;padding:8px 12px;border-radius:var(--radius-md)}
.nav-menu{list-style:none;display:flex;gap:var(--space-4);margin:0;padding:0}
.nav-menu.toggled-on{display:flex}
.site-content{min-height:50vh}
.site-footer{background:var(--color-invert-bg);color:var(--color-invert-text);padding:var(--space-6) 0;margin-top:var(--space-8)}
.widget{margin-bottom:var(--space-4)}
.widget-title{font-family:var(--font-head);margin-bottom:var(--space-2)}
.button{display:inline-block;background:var(--color-primary);color:var(--color-primary-contrast);padding:14px 24px;border-radius:var(--radius-pill);font-weight:600}
.button:hover{background:var(--color-accent);color:var(--color-invert-bg)}
.button-secondary{background:transparent;border:1px solid var(--color-border);color:var(--color-text)}
.post-thumbnail{overflow:hidden;border-radius:var(--radius-md)}
.thumb-img{width:100%;object-fit:cover}
.placeholder{display:block;aspect-ratio:16/9;border-radius:var(--radius-md);overflow:hidden}
.placeholder-svg{width:100%;height:100%;display:block}
.entry-meta{color:var(--color-muted);font-size:.85rem;display:flex;gap:var(--space-2)}
.entry-date{font-variant-numeric:tabular-nums}
.byline{color:var(--color-muted)}
.entry-footer{margin-top:var(--space-4);color:var(--color-muted);font-size:.85rem}
.cat-links,.tags-links{display:inline-block;margin-right:var(--space-3)}
.pagination{display:flex;gap:var(--space-2);margin:var(--space-6) 0}
.wpforge-form{display:grid;gap:var(--space-3);max-width:36rem}
.form-row{display:grid;gap:6px}
.form-label{font-weight:600}
.form-input,.form-textarea,.form-select{padding:12px;border:1px solid var(--color-border);border-radius:var(--radius-md);font:inherit;background:var(--color-surface)}
.form-submit{justify-self:start}
.form-notice{padding:var(--space-3);border-radius:var(--radius-md);background:var(--color-surface);border:1px solid var(--color-border)}
.screen-reader-text{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.page-section{padding:var(--space-8) 0}
.hero-split{display:grid;grid-template-columns:1.2fr .8fr;gap:var(--space-6);align-items:center;padding:var(--space-8) 0}
.feature-band{background:var(--color-invert-bg);color:var(--color-invert-text);padding:var(--space-8) 0}
.feature-band a{color:var(--color-accent)}
.list-item{display:grid;grid-template-columns:280px 1fr;gap:var(--space-4);padding:var(--space-4) 0;border-bottom:1px solid var(--color-border)}
.article-body{max-width:42rem;margin:0 auto}
.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:.75rem;color:var(--color-accent);font-weight:700}
.reveal{will-change:opacity,transform}
html.js .reveal{opacity:0;transform:translateY(24px);transition:opacity .7s ease,transform .7s ease}
html.js .reveal.is-visible{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){html.js .reveal{opacity:1;transform:none;transition:none}}
.wp-caption{max-width:100%}
.alignleft{float:left;margin:0 var(--space-4) var(--space-3) 0}
.alignright{float:right;margin:0 0 var(--space-3) var(--space-4)}
.aligncenter{margin-left:auto;margin-right:auto}
.sticky{outline:2px solid var(--color-accent)}
.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-2)}
:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px}
@media (max-width:768px){.menu-toggle{display:block}.nav-menu{display:none;flex-direction:column}.hero-split,.list-item{grid-template-columns:1fr}}
`;

const DRY_MOTION_JS = `(function(){try{var els=document.querySelectorAll('.reveal');if(!('IntersectionObserver' in window)||(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)){for(var i=0;i<els.length;i++){els[i].classList.add('is-visible');}return;}var io=new IntersectionObserver(function(entries){entries.forEach(function(e,k){if(e.isIntersecting){e.target.style.transitionDelay=(k*80)+'ms';e.target.classList.add('is-visible');io.unobserve(e.target);}});},{threshold:0.12,rootMargin:'0px 0px -8% 0px'});for(var j=0;j<els.length;j++){io.observe(els[j]);}}catch(e){}})();`;

export class DryModel implements Model {
  readonly model = "dry-run";

  async chat(_prompt: string, opts: CallOpts = {}): Promise<CallResult> {
    const label = opts.label ?? "";
    const rel = "<?php // wpforge dry-run stub for " + label + "\n";
    if (label.startsWith("theme:")) {
      const file = label.slice("theme:".length);
      if (file.endsWith(".php")) {
        return result(
          rel +
            "if ( ! defined( 'ABSPATH' ) ) { exit; }\n" +
            "get_header();\n?>\n<main class=\"site-content container\"><section class=\"page-section reveal\"><h1 class=\"eyebrow\">" +
            file +
            "</h1><p>Dry-run placeholder template.</p></section></main>\n<?php\nget_footer();\n"
        );
      }
    }
    if (label === "design-css" || label === "design-revise-css") {
      return result(DRY_STYLE_CSS);
    }
    if (label === "design-motion" || label === "design-revise-motion") {
      return result(DRY_MOTION_JS);
    }
    if (label === "design-class-repair") {
      return result("/* wpforge dry-run class repair */\n.dry-extra{color:var(--color-text)}\n");
    }
    if (label.startsWith("plugin:") || label === "content-model") {
      const slug = label.replace("plugin:", "");
      return result(
        "<?php\n/**\n * Plugin Name: wpforge dry " +
          slug +
          "\n */\nif ( ! defined( 'ABSPATH' ) ) { exit; }\n// dry-run stub\n"
      );
    }
    return result(rel + "// dry-run\n");
  }

  async chatJSON<T>(_prompt: string, opts: CallOpts = {}): Promise<{ data: T } & CallResult> {
    const label = opts.label ?? "";
    let obj: unknown = {};
    if (label === "brief") obj = DRY_BRIEF;
    else if (label.startsWith("design-shootout")) obj = DRY_CONCEPT;
    else if (label === "design-judge")
      obj = {
        scores: [
          { index: 0, total: 8, note: "Distinctive and buildable." },
          { index: 1, total: 6, note: "A touch generic." },
          { index: 2, total: 7, note: "Strong but risky." },
        ],
        winnerIndex: 0,
        improvements: "Push the type scale bigger on the hero and let the accent carry the CTA.",
      };
    else if (label === "design-spec") obj = DRY_SPEC;
    else if (label === "design-critique")
      obj = { verdict: "ship", cssPatchNeeded: false, jsPatchNeeded: false, issues: [] };
    else if (label === "blog-topics")
      obj = {
        categories: ["Studio News", "Practice Tips"],
        posts: [
          { title: "Five Breaths to Start Your Morning", category: "Practice Tips", tags: ["breathwork", "morning"], angle: "A short pranayama routine." },
          { title: "Meet Our New Restorative Teacher", category: "Studio News", tags: ["teachers"], angle: "A quick introduction." },
          { title: "Why We Practice Barefoot", category: "Practice Tips", tags: ["basics"], angle: "Grounding and balance." },
        ],
      };
    else if (label.startsWith("cpt-titles:"))
      obj = { items: [{ title: "Morning Vinyasa Flow", angle: "Energizing start" }, { title: "Candlelit Yin", angle: "Deep evening stretch" }, { title: "Restore & Reset", angle: "Gentle recovery" }] };
    else if (label.startsWith("page:")) {
      const slug = label.slice("page:".length);
      obj = { title: slug, slug, excerpt: "Dry-run page.", content: "<h2>" + slug + "</h2><p>Dry-run content for the " + slug + " page.</p>" };
    } else if (label.startsWith("post:")) {
      const slug = label.slice("post:".length);
      obj = { title: slug, slug, excerpt: "Dry-run post.", content: "<p>Dry-run post body.</p>", categories: ["Studio News"], tags: ["news"] };
    } else if (label.startsWith("cpt-item:")) {
      const title = label.slice("cpt-item:".length);
      obj = { title, slug: title.toLowerCase().replace(/\s+/g, "-"), excerpt: "A calming class.", content: "<p>Dry-run class description.</p>", meta: { level: "All levels", duration: 60, teacher: "Ana" }, terms: { class_style: ["Vinyasa"] } };
    }
    const text = JSON.stringify(obj);
    return { data: obj as T, ...result(text) };
  }
}
