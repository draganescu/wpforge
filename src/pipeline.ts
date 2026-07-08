// Orchestrates the whole generation. Sequential where there's a real data
// dependency (brief → design → contract), then one big concurrent fan-out for
// every theme file, every plugin and every piece of sample content, all sharing
// a single concurrency limiter so we stay within Cerebras rate limits.
import path from "node:path";
import type { Config } from "./config";
import type { Model } from "./cerebras";
import type {
  Brief,
  ForgeResult,
  GeneratedFile,
  GeneratedImage,
  GeneratedPlugin,
  SeedCptItem,
  SeedData,
  SeedImageRef,
  SeedPage,
  SeedPost,
  StepMetric,
} from "./types";
import { pLimit, log, placeMissingShortcodes } from "./util";
import { helpersPhp } from "./placeholder";
import { buildSeedPlugin } from "./seed";
import { themeFileSpecs } from "./prompts";
import { GeminiImages } from "./gemini";
import {
  buildContract,
  stepBlogTopics,
  stepBrief,
  stepClassRepair,
  stepContentModel,
  stepCptItem,
  stepCptTitles,
  stepDesign,
  stepFeaturePlugin,
  stepPageContent,
  stepPostContent,
  stepSeedImage,
  stepThemeFile,
  BlogTopic,
  ImageJob,
} from "./steps";
import { missingClasses, unknownTemplateClasses } from "./designGuards";

const BLOG_SLUGS = new Set(["blog", "journal", "news", "articles", "stories"]);

export async function forge(
  model: Model,
  cfg: Config,
  userPrompt: string
): Promise<ForgeResult> {
  const metrics: StepMetric[] = [];
  const record = (m: StepMetric) => {
    metrics.push(m);
    if (m.ok) log.done(m.label, m.ms, m.tokens);
    else log.fail(m.label, m.ms, "generation failed — skipped");
  };

  // ── 1. Brief ──────────────────────────────────────────────────────────────
  log.step("Planning the site (brief)");
  const { brief, metric: bm } = await stepBrief(model, userPrompt);
  record(bm);
  log.info(
    `${brief.siteName} — ${brief.pages.length} pages, ${brief.postTypes.length} post types, ${brief.features.length} feature plugins`
  );

  // ── 2. Design system ───────────────────────────────────────────────────────
  log.step("Designing the visual system (shootout → judge → spec → css + motion → critique)");
  // Pass `record` so each design sub-step logs live as it completes, rather
  // than the whole phase's lines appearing at once when stepDesign returns.
  const { design } = await stepDesign(model, brief, cfg, record);
  log.info(
    `${design.headingFont.family} / ${design.bodyFont.family} · ${design.palette.primary} on ${design.palette.bg}` +
      ` · ${Object.keys(design.classes).length} classes · motion ${design.motionJs ? "on" : "off"}`
  );

  const contract = buildContract(brief, design);

  // ── 3. Content planning (small, quick, concurrent) ─────────────────────────
  log.step("Planning sample content");
  const planLimit = pLimit(cfg.concurrency);
  const topicsP = planLimit(() => stepBlogTopics(model, brief));
  const cptTitlesP = brief.postTypes.map((pt) =>
    planLimit(() => stepCptTitles(model, pt, brief).then((r) => ({ pt, ...r })))
  );
  const topicsRes = await topicsP;
  record(topicsRes.metric);
  const cptTitleRes = await Promise.all(cptTitlesP);
  cptTitleRes.forEach((r) => record(r.metric));

  // ── 4. Big fan-out ─────────────────────────────────────────────────────────
  const limit = pLimit(cfg.concurrency);
  const themeFiles: GeneratedFile[] = [];
  const featurePlugins: GeneratedPlugin[] = [];
  const pages: SeedPage[] = [];
  const posts: SeedPost[] = [];
  const cptItems: SeedCptItem[] = [];
  let contentModelPlugin: GeneratedPlugin | undefined;

  const specs = themeFileSpecs(brief);
  const total =
    specs.length +
    (brief.postTypes.length ? 1 : 0) +
    brief.features.length +
    brief.pages.length +
    topicsRes.topics.length +
    cptTitleRes.reduce((n, r) => n + r.titles.length, 0);
  log.step(
    `Generating ${total} artifacts concurrently (theme, plugins, content) — up to ${cfg.concurrency} at a time`
  );

  const jobs: Promise<void>[] = [];
  // NOTE: pass a THUNK so the limiter controls when the API call starts.
  // Passing an already-invoked promise would fire every call at once.
  const guard = <T>(thunk: () => Promise<T>, onOk: (v: T) => void, label: string) =>
    jobs.push(
      limit(thunk)
        .then(onOk)
        .catch((e: unknown) => {
          record({ label, ms: 0, tokens: 0, ok: false });
          if (cfg.verbose) log.err(`${label}: ${(e as Error)?.message ?? e}`);
        })
    );

  // theme files
  for (const spec of specs) {
    guard(
      () => stepThemeFile(model, spec, brief, design, contract),
      (r) => {
        themeFiles.push(r.file);
        record(r.metric);
      },
      `theme/${spec.path}`
    );
  }
  // content-model plugin
  if (brief.postTypes.length) {
    guard(
      () => stepContentModel(model, brief, contract),
      (r) => {
        contentModelPlugin = r.plugin;
        record(r.metric);
      },
      `plugin/${contract.themeSlug}-content-model`
    );
  }
  // feature plugins
  for (const feature of brief.features) {
    guard(
      () => stepFeaturePlugin(model, feature, brief, contract),
      (r) => {
        featurePlugins.push(r.plugin);
        record(r.metric);
      },
      `plugin/${contract.themeSlug}-${feature.key}`
    );
  }
  // pages
  for (const page of brief.pages) {
    guard(
      () => stepPageContent(model, page, brief),
      (r) => {
        pages.push({ ...r.page, menuOrder: page.navOrder ?? 0, template: page.template });
        record(r.metric);
      },
      `page/${page.slug}`
    );
  }
  // posts
  for (const topic of topicsRes.topics as BlogTopic[]) {
    guard(
      () => stepPostContent(model, topic, brief),
      (r) => {
        posts.push(r.post);
        record(r.metric);
      },
      `post/${topic.title}`
    );
  }
  // cpt items
  for (const { pt, titles } of cptTitleRes) {
    for (const item of titles) {
      guard(
        () => stepCptItem(model, pt, item, brief),
        (r) => {
          cptItems.push(r.item);
          record(r.metric);
        },
        `${pt.key}/${item.title}`
      );
    }
  }

  await Promise.all(jobs);

  // ── 4a. Class-coverage repair ──────────────────────────────────────────────
  // The templates were fanned out in parallel against the design's vocabulary.
  // Style any class they actually used that the stylesheet never defined —
  // declared vocabulary the CSS forgot, plus structural classes a template
  // invented — so nothing renders unstyled. One cheap call, only if needed.
  if (design.styleCss && design.spec) {
    const declared = Object.keys(design.classes);
    const forgot = missingClasses(design.styleCss, declared);
    const invented = unknownTemplateClasses(themeFiles.map((f) => f.content), declared);
    const repairSet = Array.from(new Set([...forgot, ...invented])).slice(0, 24);
    if (repairSet.length) {
      log.step(`Styling ${repairSet.length} unstyled class(es) the templates used`);
      try {
        const { patch, metric } = await stepClassRepair(model, design.spec, design.styleCss, repairSet);
        record(metric);
        if (patch) {
          design.styleCss =
            design.styleCss.trimEnd() +
            "\n\n/* wpforge: styles for classes the templates used but the stylesheet omitted */\n" +
            patch +
            "\n";
        }
      } catch (e) {
        if (cfg.verbose) log.err(`class repair: ${(e as Error)?.message ?? e}`);
      }
    }
  }

  // ── 4b. Featured images (content model wrote each spec in context) ────────
  const genImages: GeneratedImage[] = [];
  const imageRefs: SeedImageRef[] = [];
  if (cfg.images) {
    const imageJobs: ImageJob[] = [
      ...pages.filter((p) => p.image).map((p) => ({ target: "page", slug: p.slug, spec: p.image! })),
      ...posts.filter((p) => p.image).map((p) => ({ target: "post", slug: p.slug, spec: p.image! })),
      ...cptItems.filter((i) => i.image).map((i) => ({ target: i.postType, slug: i.slug, spec: i.image! })),
    ];
    if (imageJobs.length) {
      log.step(`Generating ${imageJobs.length} featured images (${cfg.imageModel})`);
      // Empirically the Gemini image endpoint absorbs 24 concurrent requests
      // without a 429 on a Tier-1 key (Jul 2026), and GeminiImages retries
      // 429s with backoff — so the shared concurrency setting (≤16) is safe.
      const gemini = new GeminiImages({ apiKey: cfg.geminiApiKey, model: cfg.imageModel });
      const imgLimit = pLimit(cfg.concurrency);
      await Promise.all(
        imageJobs.map((job) =>
          imgLimit(() => stepSeedImage(gemini, job, design))
            .then((r) => {
              genImages.push(r.image);
              imageRefs.push(r.ref);
              record(r.metric);
            })
            .catch((e: unknown) => {
              record({ label: `image/${job.target}:${job.slug}`, ms: 0, tokens: 0, ok: false });
              if (cfg.verbose) log.err(`image/${job.slug}: ${(e as Error)?.message ?? e}`);
            })
        )
      );
    }
  } else if (!cfg.dryRun && !cfg.geminiApiKey) {
    log.info("GEMINI_API_KEY not set — skipping featured images (SVG placeholders will render).");
  }

  // ── 5. Assemble seed data ──────────────────────────────────────────────────
  // A feature plugin nobody can see is a dead feature: make sure every
  // shortcode landed on a page even if the copywriter model dropped it.
  const placement = placeMissingShortcodes(pages, brief.features);
  for (const p of placement.placed) {
    log.warn(`shortcode [${p.shortcode}] missing from page copy — appended to "${p.page}"`);
  }
  for (const s of placement.unplaced) {
    log.warn(`shortcode [${s}] could not be placed on any page — feature is unreachable`);
  }
  const seed = assembleSeed(brief, pages, posts, cptItems, topicsRes.categories, contract.menuLocation);
  if (imageRefs.length) seed.images = imageRefs;

  // ── 6. Deterministic theme files (helpers + stylesheet) ────────────────────
  themeFiles.push({ path: "inc/wpforge-helpers.php", content: helpersPhp(design, contract) });
  themeFiles.push({ path: "style.css", content: buildStyleCss(brief, design, contract) });

  // ── 7. Collect plugins (content-model + features + seed) ───────────────────
  const plugins: GeneratedPlugin[] = [];
  if (contentModelPlugin) plugins.push(contentModelPlugin);
  plugins.push(...featurePlugins);
  plugins.push(buildSeedPlugin(seed, contract));

  return {
    brief,
    design,
    contract,
    themeFiles,
    plugins,
    seed,
    images: genImages,
    metrics,
    outDir: path.join(cfg.outputRoot, contract.themeSlug),
  };
}

// ─── Seed assembly ────────────────────────────────────────────────────────────
function assembleSeed(
  brief: Brief,
  pages: SeedPage[],
  posts: SeedPost[],
  cptItems: SeedCptItem[],
  blogCategories: string[],
  menuLocation: string
): SeedData {
  // Front page: explicit front-page template, else "home", else first page.
  const frontSlug =
    brief.pages.find((p) => p.template === "front-page")?.slug ??
    (brief.pages.find((p) => p.slug === "home")?.slug || brief.pages[0]?.slug);

  for (const pg of pages) {
    if (pg.slug === frontSlug) pg.isFrontPage = true;
  }

  // Blog index page (only if there are posts).
  if (posts.length > 0) {
    const existingBlog = pages.find((p) => BLOG_SLUGS.has(p.slug) && p.slug !== frontSlug);
    if (existingBlog) {
      existingBlog.isBlogIndex = true;
    } else {
      pages.push({
        title: "Journal",
        slug: "journal",
        content: "",
        isBlogIndex: true,
        menuOrder: 90,
      });
    }
  }

  // Menu: brief pages with a navOrder, ordered, plus the blog index page.
  const menuItems: { title: string; slug: string }[] = brief.pages
    .filter((p) => p.navOrder !== undefined && p.navOrder !== null)
    .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99))
    .map((p) => ({ title: p.title, slug: p.slug }));
  const blogPage = pages.find((p) => p.isBlogIndex);
  if (blogPage && !menuItems.some((m) => m.slug === blogPage.slug)) {
    menuItems.push({ title: blogPage.title, slug: blogPage.slug });
  }

  const categories = Array.from(
    new Set([...blogCategories, ...posts.flatMap((p) => p.categories)])
  ).filter(Boolean);

  return {
    pages,
    posts,
    cptItems,
    categories,
    menu: { name: brief.primaryMenuName, location: menuLocation, items: menuItems },
    options: { blogname: brief.siteName, blogdescription: brief.tagline },
  };
}

// ─── style.css ────────────────────────────────────────────────────────────────
interface DesignSystemLike {
  styleCss: string;
  vibe?: string[];
  artDirection?: string;
}

function buildStyleCss(brief: Brief, design: DesignSystemLike, contract: { themeName: string; textDomain: string }): string {
  const header = `/*!
Theme Name: ${contract.themeName}
Theme URI:
Author: wpforge (Cerebras + Qwen)
Description: ${brief.description} Generated by wpforge — a classic WordPress theme. ${design.artDirection ?? ""}
Version: 1.0.0
Requires at least: 6.0
Requires PHP: 8.1
License: GNU General Public License v2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html
Text Domain: ${contract.textDomain}
Tags: classic-theme, custom-menu, featured-images, ${(design.vibe ?? []).join(", ")}
*/
`;
  // Backstop: whatever container markup wp_nav_menu ends up emitting (drift,
  // wp_page_menu fallback), menu lists must never render browser bullets.
  // Reset only — layout/display stays with the generated stylesheet.
  const navReset = `
/* wpforge backstop: menu list reset regardless of nav container markup */
.main-navigation ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
`;
  return header + "\n" + (design.styleCss ?? "").trim() + "\n" + navReset;
}
