// Individual generation units. Each does exactly one model call (or a pure
// transform) and returns its data plus a StepMetric. pipeline.ts sequences the
// dependent steps (brief → design) and fans the rest out under a shared limiter.
import type { Model } from "./cerebras";
import { buildImagePrompt, type GeminiImages } from "./gemini";
import type {
  Brief,
  BriefFeature,
  BriefPostType,
  DesignSystem,
  GeneratedFile,
  GeneratedImage,
  GeneratedPlugin,
  SeedCptItem,
  SeedImageRef,
  SeedImageSpec,
  SeedPage,
  SeedPost,
  StepMetric,
  ThemeContract,
} from "./types";
import {
  briefPrompt,
  blogTopicsPrompt,
  contentModelPrompt,
  cptItemPrompt,
  cptTitlesPrompt,
  CLASS_VOCAB,
  designTokensPrompt,
  stylesheetPrompt,
  featurePluginPrompt,
  pageContentPrompt,
  postContentPrompt,
  themeFilePrompt,
  ThemeFileSpec,
} from "./prompts";
import { fn } from "./placeholder";
import { hardenNavMenuArgs, hardenPhpCallbacks, postTypeKey, resolvePageSlug, slugify } from "./util";

// Generous ceilings: GLM-4.7 is a reasoning model, so its thinking tokens share
// the max_tokens budget with the actual output. Too low = the JSON/code gets
// truncated mid-string. TPM is high, so headroom is cheap.
const CODE_MAX = 14000;
const CONTENT_MAX = 7000;

// ─── Font href ──────────────────────────────────────────────────────────────
export function buildFontsHref(design: DesignSystem): string {
  const fams = new Map<string, Set<number>>();
  for (const f of [design.headingFont, design.bodyFont]) {
    if (!f?.family) continue;
    const set = fams.get(f.family) ?? new Set<number>();
    for (const w of f.weights?.length ? f.weights : [400, 700]) set.add(w);
    fams.set(f.family, set);
  }
  const parts: string[] = [];
  for (const [family, weights] of fams) {
    const fam = family.trim().replace(/\s+/g, "+");
    const w = [...weights].sort((a, b) => a - b).join(";");
    parts.push(`family=${fam}:wght@${w}`);
  }
  if (!parts.length) return "";
  return `https://fonts.googleapis.com/css2?${parts.join("&")}&display=swap`;
}

// ─── Brief ──────────────────────────────────────────────────────────────────
export async function stepBrief(
  model: Model,
  userPrompt: string
): Promise<{ brief: Brief; metric: StepMetric }> {
  const { system, user } = briefPrompt(userPrompt);
  const r = await model.chatJSON<Brief>(user, {
    system,
    temperature: 0.5,
    maxTokens: 6000,
    label: "brief",
  });
  const brief = normalizeBrief(r.data);
  return {
    brief,
    metric: { label: "brief (plan)", ms: r.ms, tokens: r.completionTokens, ok: true },
  };
}

function normalizeBrief(b: Brief): Brief {
  b.pages = (b.pages ?? []).map((p) => ({ ...p, slug: slugify(p.slug || p.title) }));
  b.postTypes = (b.postTypes ?? []).map((pt) => ({
    ...pt,
    key: postTypeKey(pt.key || pt.labelSingular),
    supports: pt.supports?.length ? pt.supports : ["title", "editor", "thumbnail", "excerpt"],
    fields: (pt.fields ?? []).map((f) => ({ ...f, name: slugify(f.name).replace(/-/g, "_") })),
    taxonomies: (pt.taxonomies ?? []).map((t) => ({
      ...t,
      key: postTypeKey(t.key || t.label),
      terms: t.terms ?? [],
    })),
    sampleCount: Math.max(1, Math.min(pt.sampleCount || 3, 8)),
  }));
  const pageSlugs = b.pages.map((p) => p.slug);
  b.features = (b.features ?? []).map((f) => {
    // The brief model writes onPage and the page slugs in separate breaths —
    // resolve its reference to a real page slug so exact matches downstream
    // (shortcode embedding) don't silently miss.
    const want = f.onPage ? slugify(f.onPage) : undefined;
    return {
      ...f,
      key: slugify(f.key || f.name),
      shortcode: (f.shortcode || slugify(f.name).replace(/-/g, "_")).replace(/[^a-z0-9_]/gi, "_"),
      onPage: want ? resolvePageSlug(want, pageSlugs) ?? want : undefined,
    };
  });
  b.blogPostCount = Math.max(0, Math.min(b.blogPostCount ?? 3, 8));
  b.primaryMenuName = b.primaryMenuName || "Primary";
  b.languageCode = b.languageCode || "en_US";
  b.designKeywords = b.designKeywords?.length ? b.designKeywords : ["modern", "clean"];
  return b;
}

// ─── Design (tokens JSON, then stylesheet as raw CSS) ───────────────────────
const DEFAULT_PALETTE = {
  bg: "#faf9f6",
  surface: "#ffffff",
  text: "#1a1a1a",
  muted: "#6b6b6b",
  primary: "#2f4858",
  primaryContrast: "#ffffff",
  accent: "#c98a3b",
  border: "#e6e3dc",
};

function normalizeTokens(t: DesignSystem): DesignSystem {
  t.palette = { ...DEFAULT_PALETTE, ...(t.palette ?? {}) };
  t.headingFont = t.headingFont?.family
    ? { ...t.headingFont, weights: t.headingFont.weights?.length ? t.headingFont.weights : [400, 700] }
    : { family: "Fraunces", fallback: "Georgia, serif", weights: [400, 600] };
  t.bodyFont = t.bodyFont?.family
    ? { ...t.bodyFont, weights: t.bodyFont.weights?.length ? t.bodyFont.weights : [400, 600] }
    : { family: "Inter", fallback: "system-ui, sans-serif", weights: [400, 600] };
  t.radius = t.radius ?? { sm: "6px", md: "12px", lg: "20px", pill: "999px" };
  t.vibe = t.vibe?.length ? t.vibe : ["modern", "clean"];
  t.artDirection = t.artDirection ?? "";
  return t;
}

export async function stepDesign(
  model: Model,
  brief: Brief
): Promise<{ design: DesignSystem; metrics: StepMetric[] }> {
  // 2a. Tokens (small, safe JSON)
  const tp = designTokensPrompt(brief);
  const tr = await model.chatJSON<DesignSystem>(tp.user, {
    system: tp.system,
    temperature: 0.75,
    maxTokens: 6000,
    label: "design-tokens",
  });
  const tokens = normalizeTokens(tr.data);

  // 2b. Stylesheet (raw CSS text — no JSON escaping to get wrong)
  const sp = stylesheetPrompt(brief, tokens);
  const sr = await model.chat(sp.user, {
    system: sp.system,
    temperature: 0.55,
    maxTokens: 18000,
    label: "design-css",
  });

  const design: DesignSystem = {
    ...tokens,
    styleCss: sr.text,
    classes: CLASS_VOCAB,
    googleFontsHref: buildFontsHref(tokens),
  };
  return {
    design,
    metrics: [
      { label: "design tokens", ms: tr.ms, tokens: tr.completionTokens, ok: true },
      { label: "stylesheet (css)", ms: sr.ms, tokens: sr.completionTokens, ok: true },
    ],
  };
}

// ─── Contract (pure) ────────────────────────────────────────────────────────
export function buildContract(brief: Brief, design: DesignSystem): ThemeContract {
  const themeName = brief.siteName || "WPForge Site";
  const themeSlug = slugify(themeName) || "wpforge-site";
  const contract: ThemeContract = {
    themeName,
    themeSlug,
    textDomain: themeSlug,
    googleFontsHref: design.googleFontsHref || buildFontsHref(design),
    classes: CLASS_VOCAB,
    menuLocation: "primary",
    sidebarId: "sidebar-1",
    templateTags: [],
    postTypes: brief.postTypes,
  };
  const p = fn(contract);
  contract.templateTags = [
    {
      fn: `${p}_placeholder`,
      signature: `${p}_placeholder( $label = '', $classes = '' )`,
      description: "echo a themed vector placeholder for an empty image area",
    },
    {
      fn: `${p}_post_thumbnail`,
      signature: `${p}_post_thumbnail( $size = 'large', $wrapper_class = 'post-thumbnail' )`,
      description: "echo the featured image, or the vector placeholder if none, inside a wrapper",
    },
    {
      fn: `${p}_posted_on`,
      signature: `${p}_posted_on()`,
      description: "echo the post date + author as .entry-meta",
    },
    {
      fn: `${p}_entry_footer`,
      signature: `${p}_entry_footer()`,
      description: "echo the post categories + tags as .entry-footer",
    },
  ];
  return contract;
}

// ─── Theme file ─────────────────────────────────────────────────────────────
export async function stepThemeFile(
  model: Model,
  spec: ThemeFileSpec,
  brief: Brief,
  design: DesignSystem,
  contract: ThemeContract
): Promise<{ file: GeneratedFile; metric: StepMetric }> {
  const { system, user } = themeFilePrompt(spec, brief, design, contract);
  const r = await model.chat(user, {
    system,
    temperature: 0.3,
    maxTokens: CODE_MAX,
    label: `theme:${spec.path}`,
  });
  return {
    file: { path: spec.path, content: hardenNavMenuArgs(hardenPhpCallbacks(r.text)) },
    metric: { label: `theme/${spec.path}`, ms: r.ms, tokens: r.completionTokens, ok: true },
  };
}

// ─── Content-model plugin ───────────────────────────────────────────────────
export async function stepContentModel(
  model: Model,
  brief: Brief,
  contract: ThemeContract
): Promise<{ plugin: GeneratedPlugin; metric: StepMetric }> {
  const slug = `${contract.themeSlug}-content-model`;
  const { system, user } = contentModelPrompt(brief, contract);
  const r = await model.chat(user, {
    system,
    temperature: 0.3,
    maxTokens: CODE_MAX,
    label: "content-model",
  });
  return {
    plugin: { slug, name: `${contract.themeName} Content Model`, files: [{ path: `${slug}.php`, content: hardenPhpCallbacks(r.text) }] },
    metric: { label: `plugin/${slug}`, ms: r.ms, tokens: r.completionTokens, ok: true },
  };
}

// ─── Feature plugin ─────────────────────────────────────────────────────────
export async function stepFeaturePlugin(
  model: Model,
  feature: BriefFeature,
  brief: Brief,
  contract: ThemeContract
): Promise<{ plugin: GeneratedPlugin; metric: StepMetric }> {
  const slug = `${contract.themeSlug}-${feature.key}`;
  const { system, user } = featurePluginPrompt(feature, brief, contract);
  const r = await model.chat(user, {
    system,
    temperature: 0.35,
    maxTokens: CODE_MAX,
    label: `plugin:${slug}`,
  });
  return {
    plugin: { slug, name: feature.name, files: [{ path: `${slug}.php`, content: hardenPhpCallbacks(r.text) }] },
    metric: { label: `plugin/${slug}`, ms: r.ms, tokens: r.completionTokens, ok: true },
  };
}

// ─── Content planning ───────────────────────────────────────────────────────
export interface BlogTopic {
  title: string;
  category: string;
  tags: string[];
  angle: string;
}

export async function stepBlogTopics(
  model: Model,
  brief: Brief
): Promise<{ topics: BlogTopic[]; categories: string[]; metric: StepMetric }> {
  if (brief.blogPostCount <= 0) {
    return { topics: [], categories: [], metric: { label: "blog topics", ms: 0, tokens: 0, ok: true } };
  }
  const { system, user } = blogTopicsPrompt(brief);
  const r = await model.chatJSON<{ categories: string[]; posts: BlogTopic[] }>(user, {
    system,
    temperature: 0.7,
    maxTokens: CONTENT_MAX,
    label: "blog-topics",
  });
  return {
    topics: (r.data.posts ?? []).slice(0, brief.blogPostCount),
    categories: r.data.categories ?? [],
    metric: { label: "blog topics", ms: r.ms, tokens: r.completionTokens, ok: true },
  };
}

export async function stepCptTitles(
  model: Model,
  pt: BriefPostType,
  brief: Brief
): Promise<{ titles: { title: string; angle: string }[]; metric: StepMetric }> {
  const { system, user } = cptTitlesPrompt(pt, brief);
  const r = await model.chatJSON<{ items: { title: string; angle: string }[] }>(user, {
    system,
    temperature: 0.7,
    maxTokens: CONTENT_MAX,
    label: `cpt-titles:${pt.key}`,
  });
  return {
    titles: (r.data.items ?? []).slice(0, pt.sampleCount),
    metric: { label: `titles/${pt.key}`, ms: r.ms, tokens: r.completionTokens, ok: true },
  };
}

// ─── Content items ──────────────────────────────────────────────────────────

/** Keep an LLM-written image spec only when it's actually usable. */
function cleanImageSpec(
  raw: unknown,
  fallbackAlt: string
): { prompt: string; alt: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const spec = raw as { prompt?: unknown; alt?: unknown };
  const prompt = typeof spec.prompt === "string" ? spec.prompt.trim() : "";
  if (!prompt) return undefined;
  const alt = typeof spec.alt === "string" && spec.alt.trim() ? spec.alt.trim() : fallbackAlt;
  return { prompt, alt };
}

export async function stepPageContent(
  model: Model,
  page: { title: string; slug: string; purpose: string },
  brief: Brief
): Promise<{ page: SeedPage; metric: StepMetric }> {
  const { system, user } = pageContentPrompt(page, brief, brief.features);
  const r = await model.chatJSON<SeedPage>(user, {
    system,
    temperature: 0.6,
    maxTokens: CONTENT_MAX,
    label: `page:${page.slug}`,
  });
  const data = r.data;
  return {
    page: {
      title: data.title || page.title,
      slug: page.slug,
      content: data.content || "",
      image: cleanImageSpec(data.image, data.title || page.title),
    },
    metric: { label: `page/${page.slug}`, ms: r.ms, tokens: r.completionTokens, ok: true },
  };
}

export async function stepPostContent(
  model: Model,
  topic: BlogTopic,
  brief: Brief
): Promise<{ post: SeedPost; metric: StepMetric }> {
  const { system, user } = postContentPrompt(topic, brief);
  const r = await model.chatJSON<SeedPost>(user, {
    system,
    temperature: 0.7,
    maxTokens: CONTENT_MAX,
    label: `post:${slugify(topic.title)}`,
  });
  const d = r.data;
  return {
    post: {
      title: d.title || topic.title,
      slug: slugify(d.slug || topic.title),
      content: d.content || "",
      excerpt: d.excerpt || "",
      categories: d.categories?.length ? d.categories : [topic.category],
      tags: d.tags ?? topic.tags ?? [],
      image: cleanImageSpec(d.image, d.title || topic.title),
    },
    metric: { label: `post/${slugify(topic.title)}`, ms: r.ms, tokens: r.completionTokens, ok: true },
  };
}

export async function stepCptItem(
  model: Model,
  pt: BriefPostType,
  item: { title: string; angle: string },
  brief: Brief
): Promise<{ item: SeedCptItem; metric: StepMetric }> {
  const { system, user } = cptItemPrompt(pt, item, brief);
  const r = await model.chatJSON<Omit<SeedCptItem, "postType">>(user, {
    system,
    temperature: 0.6,
    maxTokens: CONTENT_MAX,
    label: `cpt-item:${item.title}`,
  });
  const d = r.data;
  return {
    item: {
      postType: pt.key,
      title: d.title || item.title,
      slug: slugify(d.slug || item.title),
      content: d.content || "",
      excerpt: d.excerpt || "",
      meta: d.meta ?? {},
      terms: d.terms ?? {},
      image: cleanImageSpec(d.image, d.title || item.title),
    },
    metric: { label: `${pt.key}/${slugify(item.title)}`, ms: r.ms, tokens: r.completionTokens, ok: true },
  };
}

// ─── Featured images (Gemini / Nano Banana) ─────────────────────────────────
export interface ImageJob {
  /** "page" | "post" | a custom post type key */
  target: string;
  slug: string;
  spec: SeedImageSpec;
}

export async function stepSeedImage(
  gemini: GeminiImages,
  job: ImageJob,
  design: DesignSystem
): Promise<{ image: GeneratedImage; ref: SeedImageRef; metric: StepMetric }> {
  const prompt = buildImagePrompt(job.spec, design);
  const r = await gemini.generate(prompt, "16:9");
  const file = `assets/images/${slugify(job.target)}-${slugify(job.slug)}.jpg`;
  return {
    image: { path: file, data: r.data },
    ref: { file, target: job.target, slug: job.slug, alt: job.spec.alt },
    metric: { label: `image/${job.target}:${job.slug}`, ms: r.ms, tokens: 0, ok: true },
  };
}
