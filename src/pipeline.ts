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
  GeneratedPlugin,
  SeedCptItem,
  SeedData,
  SeedPage,
  SeedPost,
  StepMetric,
} from "./types";
import { pLimit, log } from "./util";
import { helpersPhp } from "./placeholder";
import { buildSeedPlugin } from "./seed";
import { themeFileSpecs } from "./prompts";
import {
  buildContract,
  stepBlogTopics,
  stepBrief,
  stepContentModel,
  stepCptItem,
  stepCptTitles,
  stepDesign,
  stepFeaturePlugin,
  stepPageContent,
  stepPostContent,
  stepThemeFile,
  BlogTopic,
} from "./steps";

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
  log.step("Designing the visual system");
  const { design, metrics: designMetrics } = await stepDesign(model, brief);
  designMetrics.forEach(record);
  log.info(
    `${design.headingFont.family} / ${design.bodyFont.family} · ${design.palette.primary} on ${design.palette.bg}`
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

  // ── 5. Assemble seed data ──────────────────────────────────────────────────
  const seed = assembleSeed(brief, pages, posts, cptItems, topicsRes.categories, contract.menuLocation);

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
  return header + "\n" + (design.styleCss ?? "").trim() + "\n";
}
