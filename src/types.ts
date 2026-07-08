// Shared data shapes that flow through the pipeline.
// The LLM produces `Brief` and `DesignSystem` (structured JSON); everything
// downstream is derived from them. Keep these permissive — the model is asked
// for a schema but we validate/normalize defensively in steps.ts.

export interface BriefPage {
  title: string;
  slug: string;
  /** short description of what this page is for — feeds content generation */
  purpose: string;
  /** which template this page should use, if special (e.g. "front-page", "contact") */
  template?: string;
  /** ordered position in the primary nav (lower = earlier); omit to hide from nav */
  navOrder?: number;
}

export interface BriefField {
  name: string;         // machine key, e.g. "price"
  label: string;        // human label, e.g. "Price"
  type: "text" | "textarea" | "number" | "url" | "date" | "email" | "image";
}

export interface BriefTaxonomy {
  key: string;          // e.g. "class_type"
  label: string;        // e.g. "Class Type"
  hierarchical: boolean;
  terms: string[];      // sample terms to seed
}

export interface BriefPostType {
  key: string;          // e.g. "class" (max 20 chars, lowercase, no spaces)
  labelSingular: string;
  labelPlural: string;
  description: string;
  hasArchive: boolean;
  supports: string[];   // e.g. ["title","editor","thumbnail","excerpt"]
  menuIcon?: string;    // dashicon slug, e.g. "dashicons-calendar-alt"
  fields: BriefField[]; // custom meta fields
  taxonomies: BriefTaxonomy[];
  /** how many sample items to generate */
  sampleCount: number;
}

export interface BriefFeature {
  /** stable slug for the plugin, e.g. "booking", "contact-form" */
  key: string;
  name: string;
  /** what the plugin must do, in plain language — drives generation */
  description: string;
  /** the shortcode the plugin exposes, e.g. "wpforge_contact_form" */
  shortcode: string;
  /** where in the site this feature is surfaced (page slug), if any */
  onPage?: string;
}

export interface Brief {
  siteName: string;
  tagline: string;
  description: string;      // 1-2 sentence site description
  industry: string;
  audience: string;
  /** mood/aesthetic keywords that seed the design system */
  designKeywords: string[];
  languageCode: string;     // e.g. "en_US"
  pages: BriefPage[];
  postTypes: BriefPostType[];
  features: BriefFeature[];
  /** how many blog posts to seed */
  blogPostCount: number;
  primaryMenuName: string;
}

export interface FontSpec {
  family: string;           // CSS family name, e.g. "Fraunces"
  fallback: string;         // e.g. "Georgia, serif"
  weights: number[];        // e.g. [400,600,700]
}

/** One competing direction from the design shootout: a compact concept, not a
 *  finished system. Cheap to generate; three of these are judged and the winner
 *  is fully realized into a DesignSpec. */
export interface DesignConcept {
  /** the design lens this concept was generated through (for logging/judging) */
  lens: string;
  /** one vivid paragraph: the concept, its references, why it fits the brand */
  thesis: string;
  palette: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    primary: string;
    primaryContrast: string;
    accent: string;
    border: string;
  };
  headingFont: string;      // a real Google Font family
  bodyFont: string;         // a real Google Font family
  heroArchetype: string;    // the front-page hero idea (e.g. "full-bleed split")
  layoutRhythm: string;     // how sections alternate/compose down the page
  motionConcept: string;    // the presentational-motion idea
  signatureDetail: string;  // the one memorable, brand-specific detail
}

/** A class the design step invents for THIS site's own vocabulary. */
export interface VocabClass {
  name: string;   // e.g. "hero-split", "feature-band" (no leading dot)
  role: string;   // what it is and how templates use it
}

/** How the presentational motion behaves across the site. */
export interface MotionPlan {
  concept: string;   // the overall motion idea
  reveals: string;   // which elements reveal, how, and in what order; stagger; hero choreography
}

/** The winning direction, fully realized as a buildable design system: tokens,
 *  the site's OWN class vocabulary, and a per-surface composition plan. This is
 *  what the stylesheet, motion script and every template are generated against. */
export interface DesignSpec {
  concept: string;          // the art-direction paragraph (realized winner)
  vibe: string[];
  palette: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    primary: string;
    primaryContrast: string;
    accent: string;
    border: string;
    /** optional inverted band surface + its text, for alternating dark sections */
    invertBg?: string;
    invertText?: string;
    [k: string]: string | undefined;
  };
  headingFont: FontSpec;
  bodyFont: FontSpec;
  /** prose describing the fluid type scale (base size, ratio, clamp() headlines) */
  typeScale: string;
  radius: { sm: string; md: string; lg: string; pill: string };
  motion: MotionPlan;
  /** the site's own class vocabulary for all layout + components (beyond the fixed core) */
  vocabulary: VocabClass[];
  /** ordered composition per surface: "front-page" | "archive" | "single" | "page" | "detail" */
  layouts: Record<string, string>;
}

export interface DesignSystem {
  artDirection: string;     // one-paragraph point of view for the reviewer
  vibe: string[];
  palette: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    primary: string;
    primaryContrast: string;
    accent: string;
    border: string;
    [k: string]: string;
  };
  headingFont: FontSpec;
  bodyFont: FontSpec;
  /** ready-to-use <link> href that loads both fonts from Google Fonts */
  googleFontsHref: string;
  radius: { sm: string; md: string; lg: string; pill: string };
  /** the full theme stylesheet body (design system realized as CSS). Written
   *  verbatim into style.css after the theme header. This is the make-or-break
   *  artifact — the design phase composes all tokens, layout and component
   *  classes so the parallel template files stay visually coherent. */
  styleCss: string;
  /** bespoke presentational-motion script (validated JS), inlined by the theme
   *  helpers; "" when no valid motion could be produced (site stays static). */
  motionJs: string;
  /** the structured design decision (winning direction, fully realized) */
  spec?: DesignSpec;
  /** per-surface composition plans, keyed by surface name — templates execute these */
  layouts: Record<string, string>;
  /** CSS class names templates are allowed to use (core + generated vocabulary) */
  classes: Record<string, string>;
}

/** The theme "contract": the fixed shared surface every parallel generation
 *  call must honor so independently-generated files fit together. Partly
 *  deterministic (we own the custom template-tag names), partly from design. */
export interface ThemeContract {
  themeName: string;
  themeSlug: string;
  textDomain: string;
  googleFontsHref: string;
  classes: Record<string, string>;
  menuLocation: string;      // registered nav menu location handle
  sidebarId: string;         // registered widget area id
  /** custom template-tag functions defined in functions.php that templates may call */
  templateTags: { fn: string; signature: string; description: string }[];
  postTypes: BriefPostType[];
}

export interface GeneratedFile {
  /** path relative to the artifact root (theme dir or plugin dir) */
  path: string;
  content: string;
}

export interface GeneratedPlugin {
  slug: string;
  name: string;
  files: GeneratedFile[];
}

/** What the content model said the item's featured image should show —
 *  written in context, alongside the copy it accompanies. */
export interface SeedImageSpec {
  /** subject/setting/mood description for the image model (no style words) */
  prompt: string;
  /** concise accessible description, saved as the attachment alt text */
  alt: string;
}

/** A generated image bundled inside the seed plugin, with its attachment target. */
export interface SeedImageRef {
  /** path relative to the seed plugin dir, e.g. "assets/images/page-home.jpg" */
  file: string;
  /** "page" | "post" | a custom post type key */
  target: string;
  slug: string;
  alt: string;
}

/** Binary artifact written into the seed plugin directory at assemble time. */
export interface GeneratedImage {
  /** path relative to the seed plugin dir */
  path: string;
  data: Buffer;
}

/** Structured sample content the seed plugin will insert on activation. */
export interface SeedPage {
  title: string;
  slug: string;
  content: string;          // HTML (classic, no block markup)
  isFrontPage?: boolean;
  isBlogIndex?: boolean;
  menuOrder?: number;
  template?: string;
  image?: SeedImageSpec;
}

export interface SeedPost {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  categories: string[];
  tags: string[];
  image?: SeedImageSpec;
}

export interface SeedCptItem {
  postType: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  meta: Record<string, string | number>;
  terms: Record<string, string[]>; // taxonomyKey -> term names
  image?: SeedImageSpec;
}

export interface SeedData {
  pages: SeedPage[];
  posts: SeedPost[];
  cptItems: SeedCptItem[];
  categories: string[];
  menu: { name: string; location: string; items: { title: string; slug: string }[] };
  options: {
    blogname: string;
    blogdescription: string;
  };
  /** featured images bundled with the seeder (empty when image gen is off) */
  images?: SeedImageRef[];
}

export interface StepMetric {
  label: string;
  ms: number;
  tokens: number;
  ok: boolean;
}

export interface ForgeResult {
  brief: Brief;
  design: DesignSystem;
  contract: ThemeContract;
  themeFiles: GeneratedFile[];
  plugins: GeneratedPlugin[];
  seed: SeedData;
  /** binary images to write into the seed plugin dir */
  images: GeneratedImage[];
  metrics: StepMetric[];
  outDir: string;
}
