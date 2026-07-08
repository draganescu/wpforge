// Individual generation units. Each does exactly one model call (or a pure
// transform) and returns its data plus a StepMetric. pipeline.ts sequences the
// dependent steps (brief → design) and fans the rest out under a shared limiter.
import type { Model } from "./cerebras";
import type { Config } from "./config";
import { buildImagePrompt, type GeminiImages } from "./gemini";
import type {
  Brief,
  BriefFeature,
  BriefPostType,
  DesignConcept,
  DesignSpec,
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
  VocabClass,
} from "./types";
import {
  briefPrompt,
  blogTopicsPrompt,
  contentModelPrompt,
  cptItemPrompt,
  cptTitlesPrompt,
  CORE_VOCAB,
  featurePluginPrompt,
  pageContentPrompt,
  postContentPrompt,
  themeFilePrompt,
  ThemeFileSpec,
} from "./prompts";
import {
  pickLenses,
  shootoutPrompt,
  judgePrompt,
  designSpecPrompt,
  stylesheetPrompt,
  motionPrompt,
  critiquePrompt,
  reviseStylesheetPrompt,
  reviseMotionPrompt,
  classPatchPrompt,
  LAYOUT_SURFACES,
} from "./prompts-design";
import { validateCss, validateMotionJs } from "./designGuards";
import { fn } from "./placeholder";
import { hardenNavMenuArgs, hardenPhpCallbacks, pLimit, postTypeKey, resolvePageSlug, slugify } from "./util";

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

// ─── Design phase ───────────────────────────────────────────────────────────
// A quality pipeline (shootout → judge → spec → css+motion → critique → revise)
// run at high reasoning, with deterministic gates on the CSS and motion JS.
const DEFAULT_PALETTE = {
  bg: "#faf9f6",
  surface: "#ffffff",
  text: "#1a1a1a",
  muted: "#6b6b6b",
  primary: "#2f4858",
  primaryContrast: "#ffffff",
  accent: "#c98a3b",
  border: "#e6e3dc",
  invertBg: "#1a1a1a",
  invertText: "#faf9f6",
};

const DEFAULT_HEADING = { family: "Fraunces", fallback: "Georgia, serif", weights: [400, 600] };
const DEFAULT_BODY = { family: "Inter", fallback: "system-ui, sans-serif", weights: [400, 600] };
const DEFAULT_RADIUS = { sm: "6px", md: "12px", lg: "20px", pill: "999px" };

/** The design phase should think hard — unless the operator explicitly turned
 *  reasoning off, run its calls at high effort regardless of the global default. */
function designEffort(cfg: Config): string {
  return cfg.reasoningEffort === "off" ? "off" : "high";
}

interface CritiqueIssue {
  area: string;
  severity: string;
  detail: string;
  fix: string;
}

/** Fill in anything the model omitted so the rest of the pipeline is safe. */
function normalizeSpec(s: Partial<DesignSpec>, brief: Brief, lens: string): DesignSpec {
  const palette = { ...DEFAULT_PALETTE, ...(s.palette ?? {}) };
  const headingFont = s.headingFont?.family
    ? { ...s.headingFont, weights: s.headingFont.weights?.length ? s.headingFont.weights : [400, 700] }
    : DEFAULT_HEADING;
  const bodyFont = s.bodyFont?.family
    ? { ...s.bodyFont, weights: s.bodyFont.weights?.length ? s.bodyFont.weights : [400, 600] }
    : DEFAULT_BODY;
  const vocabulary: VocabClass[] = (s.vocabulary ?? [])
    .filter((v) => v && typeof v.name === "string" && v.name.trim())
    .map((v) => ({ name: slugify(v.name), role: v.role ?? "" }))
    // never let the design shadow a core class name
    .filter((v) => !(v.name in CORE_VOCAB));
  const layouts: Record<string, string> = {};
  for (const surface of LAYOUT_SURFACES) {
    const val = s.layouts?.[surface];
    layouts[surface] = typeof val === "string" && val.trim() ? val : "";
  }
  return {
    concept: s.concept || `A ${lens} direction for ${brief.siteName}.`,
    vibe: s.vibe?.length ? s.vibe : brief.designKeywords,
    palette,
    headingFont,
    bodyFont,
    typeScale: s.typeScale || "Fluid scale: body ~1.05rem; h1 clamp(2.5rem, 6vw, 4.5rem); ratio ~1.333.",
    radius: s.radius ?? DEFAULT_RADIUS,
    motion: {
      concept: s.motion?.concept || "Calm, confident entrances as content scrolls into view.",
      reveals:
        s.motion?.reveals ||
        "Section blocks fade and rise 24px as they enter the viewport, staggered slightly within each group.",
    },
    vocabulary,
    layouts,
  };
}

/** Merge the core plumbing classes with the site's invented vocabulary into the
 *  single name→role map templates are generated against. */
function classesFor(spec: DesignSpec): Record<string, string> {
  const classes: Record<string, string> = { ...CORE_VOCAB };
  for (const v of spec.vocabulary) classes[v.name] = v.role;
  return classes;
}

/** Realize a DesignSpec as a DesignSystem: run the CSS + motion generations
 *  (concurrently) with their deterministic gates and one revise pass. */
export async function stepDesign(
  model: Model,
  brief: Brief,
  cfg: Config,
  onMetric?: (m: StepMetric) => void
): Promise<{ design: DesignSystem; metrics: StepMetric[] }> {
  const metrics: StepMetric[] = [];
  const effort = designEffort(cfg);
  // Report each sub-step the moment it finishes (onMetric) instead of batching
  // — otherwise all ~10 design lines print at once when the phase returns.
  const push = (label: string, ms: number, toks: number, ok = true) => {
    const m: StepMetric = { label, ms, tokens: toks, ok };
    metrics.push(m);
    onMetric?.(m);
  };

  // ── 2a. Shootout: three competing directions, concurrently ────────────────
  const lenses = pickLenses(brief, 3);
  const limit = pLimit(cfg.concurrency);
  const conceptResults = await Promise.all(
    lenses.map((lens) =>
      limit(async () => {
        try {
          const p = shootoutPrompt(brief, lens);
          const r = await model.chatJSON<DesignConcept>(p.user, {
            system: p.system,
            temperature: 0.85,
            maxTokens: 5000,
            reasoningEffort: effort,
            label: `design-shootout:${lens}`,
          });
          push(`design direction (${lens})`, r.ms, r.completionTokens);
          return { ...r.data, lens: r.data.lens || lens };
        } catch (e) {
          push(`design direction (${lens})`, 0, 0, false);
          return null;
        }
      })
    )
  );
  const concepts = conceptResults.filter((c): c is DesignConcept => !!c);

  // ── 2b. Judge → winner + improvement notes ────────────────────────────────
  let winner: DesignConcept;
  let improvements = "";
  if (concepts.length > 1) {
    try {
      const jp = judgePrompt(brief, concepts);
      const jr = await model.chatJSON<{ winnerIndex: number; improvements: string }>(jp.user, {
        system: jp.system,
        temperature: 0.4,
        maxTokens: 3000,
        reasoningEffort: effort,
        label: "design-judge",
      });
      const idx = Number.isInteger(jr.data.winnerIndex) ? jr.data.winnerIndex : 0;
      winner = concepts[idx] ?? concepts[0];
      improvements = jr.data.improvements || "";
      push(`design judge → "${winner.lens}"`, jr.ms, jr.completionTokens);
    } catch {
      winner = concepts[0];
      push("design judge", 0, 0, false);
    }
  } else {
    winner = concepts[0] ?? fallbackConcept(brief, lenses[0] ?? "editorial print");
  }

  // ── 2c. Design spec: realize the winner ───────────────────────────────────
  let spec: DesignSpec;
  try {
    const dp = designSpecPrompt(brief, winner, improvements);
    const dr = await model.chatJSON<Partial<DesignSpec>>(dp.user, {
      system: dp.system,
      temperature: 0.7,
      maxTokens: 9000,
      reasoningEffort: effort,
      label: "design-spec",
    });
    spec = normalizeSpec(dr.data, brief, winner.lens);
    push("design spec", dr.ms, dr.completionTokens);
  } catch {
    spec = normalizeSpec({ concept: winner.thesis, palette: { ...DEFAULT_PALETTE, ...winner.palette } }, brief, winner.lens);
    push("design spec", 0, 0, false);
  }

  // ── 2d/2e. Stylesheet + motion script, concurrently, each gated ───────────
  const [css, motionJs] = await Promise.all([
    limit(() => generateStylesheet(model, brief, spec, effort, push)),
    limit(() => generateMotion(model, brief, spec, effort, push)),
  ]);

  // ── 2f/2g. Critique → one revise pass ─────────────────────────────────────
  let finalCss = css;
  let finalJs = motionJs;
  try {
    const cp = critiquePrompt(brief, spec, css, motionJs);
    const cr = await model.chatJSON<{
      verdict: string;
      cssPatchNeeded: boolean;
      jsPatchNeeded: boolean;
      issues: CritiqueIssue[];
    }>(cp.user, {
      system: cp.system,
      temperature: 0.4,
      maxTokens: 4000,
      reasoningEffort: effort,
      label: "design-critique",
    });
    push("design critique", cr.ms, cr.completionTokens);
    const issues = (cr.data.issues ?? []).filter((i) => i.severity === "high" || i.severity === "med");
    if (cr.data.verdict === "revise" && issues.length) {
      if (cr.data.cssPatchNeeded) {
        finalCss = await reviseStylesheet(model, brief, spec, css, issues, effort, push);
      }
      if (cr.data.jsPatchNeeded && motionJs) {
        finalJs = await reviseMotion(model, brief, spec, motionJs, issues, effort, push);
      }
    }
  } catch {
    push("design critique", 0, 0, false);
  }

  const classes = classesFor(spec);
  const design: DesignSystem = {
    artDirection: spec.concept,
    vibe: spec.vibe,
    palette: spec.palette as DesignSystem["palette"],
    headingFont: spec.headingFont,
    bodyFont: spec.bodyFont,
    googleFontsHref: buildFontsHref({ headingFont: spec.headingFont, bodyFont: spec.bodyFont } as DesignSystem),
    radius: spec.radius,
    styleCss: finalCss,
    motionJs: finalJs,
    spec,
    layouts: spec.layouts,
    classes,
  };
  return { design, metrics };
}

/** Generate + gate the stylesheet, with one retry if the deterministic check
 *  rejects it (truncated / unbalanced / degenerate). */
async function generateStylesheet(
  model: Model,
  brief: Brief,
  spec: DesignSpec,
  effort: string,
  push: (label: string, ms: number, toks: number, ok?: boolean) => void
): Promise<string> {
  const sp = stylesheetPrompt(brief, spec);
  let best = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await model.chat(sp.user, {
      system: sp.system,
      temperature: 0.55,
      maxTokens: 20000,
      reasoningEffort: effort,
      label: "design-css",
    });
    const v = validateCss(r.text);
    if (v.ok) {
      push(attempt > 1 ? "stylesheet (css, retried)" : "stylesheet (css)", r.ms, r.completionTokens);
      return r.text;
    }
    if (r.text.length > best.length) best = r.text;
    push(`stylesheet (css) rejected: ${v.reason}`, r.ms, r.completionTokens, false);
  }
  // Best-effort: keep the longest attempt (base element styles still render).
  return best;
}

/** Generate + gate the motion script. Invalid after one retry → drop motion
 *  entirely (safe: the CSS only hides .reveal under html.js, which the helpers
 *  enable only when a valid script ships). */
async function generateMotion(
  model: Model,
  brief: Brief,
  spec: DesignSpec,
  effort: string,
  push: (label: string, ms: number, toks: number, ok?: boolean) => void
): Promise<string> {
  const mp = motionPrompt(brief, spec);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await model.chat(mp.user, {
      system: mp.system,
      temperature: 0.5,
      maxTokens: 5000,
      reasoningEffort: effort,
      label: "design-motion",
    });
    const v = validateMotionJs(r.text);
    if (v.ok) {
      push(attempt > 1 ? "motion (js, retried)" : "motion (js)", r.ms, r.completionTokens);
      return r.text.trim();
    }
    push(`motion (js) rejected: ${v.reason}`, r.ms, r.completionTokens, false);
  }
  push("motion (js) dropped — site stays static", 0, 0, false);
  return "";
}

async function reviseStylesheet(
  model: Model,
  brief: Brief,
  spec: DesignSpec,
  css: string,
  issues: CritiqueIssue[],
  effort: string,
  push: (label: string, ms: number, toks: number, ok?: boolean) => void
): Promise<string> {
  const rp = reviseStylesheetPrompt(brief, spec, css, issues);
  const r = await model.chat(rp.user, {
    system: rp.system,
    temperature: 0.5,
    maxTokens: 20000,
    reasoningEffort: effort,
    label: "design-revise-css",
  });
  const v = validateCss(r.text);
  if (v.ok) {
    push("stylesheet revision", r.ms, r.completionTokens);
    return r.text;
  }
  // A revision that fails the gate is discarded — keep the passing original.
  push(`stylesheet revision rejected: ${v.reason} — kept original`, r.ms, r.completionTokens, false);
  return css;
}

async function reviseMotion(
  model: Model,
  brief: Brief,
  spec: DesignSpec,
  js: string,
  issues: CritiqueIssue[],
  effort: string,
  push: (label: string, ms: number, toks: number, ok?: boolean) => void
): Promise<string> {
  const rp = reviseMotionPrompt(brief, spec, js, issues);
  const r = await model.chat(rp.user, {
    system: rp.system,
    temperature: 0.45,
    maxTokens: 5000,
    reasoningEffort: effort,
    label: "design-revise-motion",
  });
  const v = validateMotionJs(r.text);
  if (v.ok) {
    push("motion revision", r.ms, r.completionTokens);
    return r.text.trim();
  }
  push(`motion revision rejected: ${v.reason} — kept original`, r.ms, r.completionTokens, false);
  return js;
}

/** After the template fan-out, style any classes the templates actually use but
 *  the stylesheet never defined (declared vocabulary the CSS forgot + structural
 *  classes a template invented). Returns a CSS patch to append. */
export async function stepClassRepair(
  model: Model,
  spec: DesignSpec,
  css: string,
  classes: string[]
): Promise<{ patch: string; metric: StepMetric }> {
  const { system, user } = classPatchPrompt(spec, css, classes);
  const r = await model.chat(user, {
    system,
    temperature: 0.3,
    maxTokens: 4000,
    label: "design-class-repair",
  });
  const patch = r.text.trim();
  // Only accept a well-formed, non-trivial patch with balanced braces.
  const opens = (patch.match(/\{/g) ?? []).length;
  const closes = (patch.match(/\}/g) ?? []).length;
  const ok = opens > 0 && opens === closes;
  return {
    patch: ok ? patch : "",
    metric: { label: `class repair (${classes.length} classes)`, ms: r.ms, tokens: r.completionTokens, ok },
  };
}

/** Synthetic direction if the whole shootout failed — keeps design deterministic. */
function fallbackConcept(brief: Brief, lens: string): DesignConcept {
  return {
    lens,
    thesis: `A confident ${lens} direction for ${brief.siteName}: ${brief.description}`,
    palette: DEFAULT_PALETTE,
    headingFont: DEFAULT_HEADING.family,
    bodyFont: DEFAULT_BODY.family,
    heroArchetype: "Full-bleed split hero with an oversized headline.",
    layoutRhythm: "Asymmetric sections alternating with an inverted band.",
    motionConcept: "Sections rise and fade into view as you scroll.",
    signatureDetail: "A hairline rule system tying sections together.",
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
    classes: design.classes,
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
