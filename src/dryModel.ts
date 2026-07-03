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

const DRY_DESIGN = {
  artDirection:
    "Warm, grounded and editorial: a sand-paper background, ink-dark text, a sage primary and a soft ochre accent. Fraunces gives the headings character; Inter keeps the body calm and legible.",
  vibe: ["calm", "earthy", "editorial", "warm"],
  palette: {
    bg: "#f6f2ea",
    surface: "#fffdf8",
    text: "#20261f",
    muted: "#6f6a5f",
    primary: "#4b5d43",
    primaryContrast: "#ffffff",
    accent: "#c9a25a",
    border: "#e6e0d3",
  },
  headingFont: { family: "Fraunces", fallback: "Georgia, serif", weights: [400, 600] },
  bodyFont: { family: "Inter", fallback: "system-ui, sans-serif", weights: [400, 600] },
  radius: { sm: "6px", md: "12px", lg: "20px", pill: "999px" },
  styleCss:
    ":root{--bg:#f6f2ea;--surface:#fffdf8;--text:#20261f;--muted:#6f6a5f;--primary:#4b5d43;--primary-contrast:#fff;--accent:#c9a25a;--border:#e6e0d3;--font-head:'Fraunces',Georgia,serif;--font-body:'Inter',system-ui,sans-serif;--radius:12px;--space-2:8px;--space-4:16px;--space-6:24px;--space-8:48px;--maxw:1120px}" +
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.6}" +
    "h1,h2,h3{font-family:var(--font-head);line-height:1.15}a{color:var(--primary)}img{max-width:100%;height:auto}" +
    ".container{max-width:var(--maxw);margin:0 auto;padding:0 var(--space-4)}" +
    ".button{display:inline-block;background:var(--primary);color:var(--primary-contrast);padding:12px 20px;border-radius:var(--radius);text-decoration:none}" +
    ".button-secondary{background:transparent;border:1px solid var(--border);color:var(--text)}" +
    ".card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}" +
    ".grid{display:grid;gap:var(--space-6);grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}" +
    ".hero{padding:var(--space-8) 0;background:var(--surface)}.placeholder{display:block;aspect-ratio:16/9}.placeholder-svg{width:100%;height:100%;display:block}" +
    "@media(max-width:768px){.grid{grid-template-columns:1fr}}",
};

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
            "get_header();\n?>\n<main class=\"site-content container\"><h1 class=\"page-title\">" +
            file +
            "</h1><p>Dry-run placeholder template.</p></main>\n<?php\nget_footer();\n"
        );
      }
    }
    if (label === "design-css") {
      return result(DRY_DESIGN.styleCss);
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
    else if (label === "design-tokens") {
      const { styleCss, ...tokens } = DRY_DESIGN;
      obj = tokens;
    }
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
