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
   *  artifact — one call defines all tokens, layout and component classes so
   *  the parallel template files stay visually coherent. */
  styleCss: string;
  /** CSS class names templates are allowed to use, so parallel file gen coheres */
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
