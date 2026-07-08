// The design phase — the make-or-break step, run at high reasoning. Instead of
// one "pick tokens then write CSS" pass, this is a small quality pipeline:
//
//   shootout  → 3 competing directions, each through a different design lens
//   judge     → score them, pick the winner, write notes to push it further
//   spec      → realize the winner as a full DesignSpec (tokens + the site's OWN
//               class vocabulary + a per-surface composition plan + a motion plan)
//   stylesheet→ the complete CSS realizing the spec
//   motion    → a bespoke presentational-motion script
//   critique  → an adversarial read for slop / weak typography / poor rhythm
//   revise    → one pass applying the critique
//
// Free-form vocabulary + composed layouts are what make each site look designed
// rather than assembled from the same skeleton.
import type { Brief, DesignConcept, DesignSpec, VocabClass } from "./types";
import { briefContext, CORE_VOCAB } from "./prompts";

// The named composition surfaces the design authors and templates execute.
export const LAYOUT_SURFACES = ["front-page", "archive", "single", "page", "detail"] as const;

const coreClassList = Object.entries(CORE_VOCAB)
  .map(([k, v]) => `  .${k} — ${v}`)
  .join("\n");

// ─── The art-director persona ───────────────────────────────────────────────
export const ART_DIRECTOR_SYSTEM = `You are an award-winning art director and design engineer — a lead who has shipped identity systems for boutique brands and hand-writes tasteful, production CSS. You have strong, specific taste and a horror of generic "AI website" defaults.

Your non-negotiable standards:
- A restrained, INTENTIONAL palette: a real background (rarely pure #fff), one confident primary, one accent used sparingly, carefully chosen neutrals, and — when the concept wants alternating dark bands — an inverted surface. Text/background contrast passes WCAG AA.
- A deliberate Google Fonts pairing with real personality (e.g. a characterful display serif against a clean grotesk; an expressive grotesk against a humanist text face). Never Arial/Times/system-ui as THE design.
- A fluid modular type scale (clamp()), a spacing rhythm, generous whitespace, and dramatic, confident typographic hierarchy — big where it should be big.
- DYNAMIC, asymmetric layout: split heroes, full-bleed bands, off-grid editorial columns, overlap, alternating rhythm. Never the same centered hero + three cards on every page.
- Components with a point of view. Purposeful detail (a considered radius, ONE tasteful shadow or a hairline system, a signature motif) — never decoration for its own sake.
- Presentational motion that feels choreographed: entrances reveal as you scroll, with stagger and intent — never everything sliding in identically.
- Fully responsive and mobile-first.
- Anti-slop, always: no default-Bootstrap blue, no everything-centered, no drop shadows on everything, no generic purple gradients, no emoji, no clip-art, no "Welcome to our website" filler.`;

// ─── Design lenses ──────────────────────────────────────────────────────────
// Each shootout concept is generated through ONE lens so the three directions
// are genuinely different, not three shades of the same idea.
interface Lens {
  name: string;
  tags: string[];
  brief: string;
}

const DESIGN_LENSES: Lens[] = [
  {
    name: "editorial print",
    tags: ["editorial", "magazine", "luxury", "refined", "classic", "warm", "sophisticated"],
    brief:
      "Magazine art direction: a strong masthead, real columns, pull-quotes, a drop cap, hairline rules, numbered section indices, generous margins. An authoritative display serif against a clean grotesk.",
  },
  {
    name: "brutalist geometric",
    tags: ["bold", "raw", "modern", "tech", "confident", "industrial", "edgy"],
    brief:
      "Raw, grid-exposed brutalism: heavy type, hard edges, high-contrast near-monochrome with ONE loud accent, oversized numerals, visible structural borders, zero soft shadows.",
  },
  {
    name: "quiet luxury",
    tags: ["luxury", "minimal", "calm", "premium", "elegant", "refined", "boutique"],
    brief:
      "Restrained luxury: near-monochrome neutrals, one metallic-adjacent accent, vast whitespace, small-caps labels, tight letter-spacing, understated micro-interactions, everything expensive-feeling.",
  },
  {
    name: "organic humanist",
    tags: ["warm", "earthy", "natural", "calm", "wellness", "craft", "friendly", "organic"],
    brief:
      "Warm humanist design: soft off-white grounds, an earthy palette, rounded-but-characterful type, organic asymmetry, gentle motion, tactile blob/leaf motifs used sparingly.",
  },
  {
    name: "swiss modern",
    tags: ["clean", "modern", "precise", "minimal", "professional", "corporate", "objective"],
    brief:
      "Swiss/International style: a strict, visible typographic grid, flush-left ragged-right setting, one accent, a Helvetica-lineage sans, ruthless alignment, objective clarity.",
  },
  {
    name: "retro-futurist",
    tags: ["playful", "bold", "tech", "creative", "vibrant", "energetic", "futuristic"],
    brief:
      "Retro-futurism: chunky geometric type, a saturated duotone, grid-glow accents, chrome/gradient details used with discipline, kinetic reveal motion.",
  },
  {
    name: "art-house poster",
    tags: ["creative", "artistic", "bold", "cultural", "expressive", "dramatic", "gallery"],
    brief:
      "Poster-led art direction: one enormous typographic statement, dramatic scale contrast, an unexpected color pairing, image-as-hero, motion that reveals like a title sequence.",
  },
  {
    name: "craft tactile",
    tags: ["craft", "handmade", "artisan", "warm", "authentic", "rustic", "heritage"],
    brief:
      "Artisan/craft feel: paper-and-ink CSS textures, letterpress-like type, muted naturals, stamp/label/seal motifs, small tasteful ornaments and rules.",
  },
  {
    name: "tech minimal",
    tags: ["tech", "modern", "clean", "product", "saas", "precise", "professional", "sharp"],
    brief:
      "Product/tech minimalism: a crisp neutral base, one precise accent, a tight component system, a mono face for labels/metadata, subtle depth, fast confident motion.",
  },
];

/** Stable non-random hash so lens selection varies by site but is reproducible. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Pick N distinct lenses: keyword-matched first, then rotate through the pool
 *  from a per-site offset so different briefs explore different territory. */
export function pickLenses(brief: Brief, n = 3): string[] {
  const kws = new Set((brief.designKeywords ?? []).map((k) => k.toLowerCase()));
  const scored = DESIGN_LENSES.map((l) => ({
    name: l.name,
    score: l.tags.reduce((acc, t) => acc + (kws.has(t) ? 1 : 0), 0),
  }));
  const picked: string[] = [];
  scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .forEach((s) => {
      if (picked.length < n && !picked.includes(s.name)) picked.push(s.name);
    });
  const offset = hash(brief.siteName || "wpforge") % DESIGN_LENSES.length;
  for (let i = 0; i < DESIGN_LENSES.length && picked.length < n; i++) {
    const name = DESIGN_LENSES[(offset + i) % DESIGN_LENSES.length].name;
    if (!picked.includes(name)) picked.push(name);
  }
  return picked.slice(0, n);
}

function lensByName(name: string): Lens {
  return DESIGN_LENSES.find((l) => l.name === name) ?? DESIGN_LENSES[0];
}

// ─── 2a. Shootout: one concept through one lens ─────────────────────────────
export function shootoutPrompt(brief: Brief, lensName: string): { system: string; user: string } {
  const lens = lensByName(lensName);
  const user = `${briefContext(brief)}

Design this site through ONE specific lens — commit to it fully, don't hedge toward a safe middle:
LENS "${lens.name}": ${lens.brief}

Return a compact concept as JSON with EXACTLY this shape (no extra keys):
{
  "lens": "${lens.name}",
  "thesis": string,            // one vivid paragraph: the concept, its references, why it fits THIS brand
  "palette": { "bg": hex, "surface": hex, "text": hex, "muted": hex, "primary": hex, "primaryContrast": hex, "accent": hex, "border": hex },
  "headingFont": string,       // a real Google Font family that embodies the lens
  "bodyFont": string,          // a real Google Font family that pairs with it
  "heroArchetype": string,     // the front-page hero idea, concretely (e.g. "full-bleed split, oversized serif left, image bleeding off right")
  "layoutRhythm": string,      // how sections alternate down the page (asymmetry, bands, overlap)
  "motionConcept": string,     // the presentational-motion idea
  "signatureDetail": string    // the ONE memorable, brand-specific detail that makes it unmistakable
}

Real Google Fonts only. Hex colors only. Be specific and opinionated — a distinctive, buildable direction beats a tasteful-but-generic one. Return only the JSON.`;
  return { system: ART_DIRECTOR_SYSTEM, user };
}

// ─── 2b. Judge: score the three, pick a winner, push it further ─────────────
export function judgePrompt(brief: Brief, concepts: DesignConcept[]): { system: string; user: string } {
  const system = `You are a discerning design director reviewing competing directions for a brand. You reward distinctiveness, typographic ambition, brand fit and buildability; you punish generic "AI website" safety. You are decisive.`;
  const list = concepts
    .map(
      (c, i) =>
        `[${i}] LENS "${c.lens}"
  Thesis: ${c.thesis}
  Fonts: ${c.headingFont} / ${c.bodyFont}
  Palette: bg ${c.palette?.bg}, primary ${c.palette?.primary}, accent ${c.palette?.accent}
  Hero: ${c.heroArchetype}
  Rhythm: ${c.layoutRhythm}
  Motion: ${c.motionConcept}
  Signature: ${c.signatureDetail}`
    )
    .join("\n\n");
  const user = `${briefContext(brief)}

Three competing directions:

${list}

Judge them on: brand fit, distinctiveness, typographic ambition, layout dynamism, and buildability as a classic WordPress theme. Return JSON:
{
  "scores": [ { "index": number, "total": number (0-10), "note": string } ],   // one per concept
  "winnerIndex": number,        // the index of the strongest direction
  "improvements": string        // 2-4 sentences: concrete pushes to make the winner sharper and less generic (palette, type scale, a bolder move, the signature detail)
}
Only JSON.`;
  return { system, user };
}

// ─── 2c. Design spec: realize the winner fully ──────────────────────────────
export function designSpecPrompt(
  brief: Brief,
  winner: DesignConcept,
  improvements: string
): { system: string; user: string } {
  const system = `${ART_DIRECTOR_SYSTEM}

You are now realizing an already-chosen direction as a complete, buildable design system. You invent THIS site's own class vocabulary and compose each page surface yourself — one mind composing the whole site so the rhythm is intentional and coherent.`;

  const user = `${briefContext(brief)}

WINNING DIRECTION (realize this — do not switch concepts):
Lens: ${winner.lens}
Thesis: ${winner.thesis}
Fonts: ${winner.headingFont} / ${winner.bodyFont}
Palette seed: bg ${winner.palette?.bg}, surface ${winner.palette?.surface}, text ${winner.palette?.text}, muted ${winner.palette?.muted}, primary ${winner.palette?.primary}, primaryContrast ${winner.palette?.primaryContrast}, accent ${winner.palette?.accent}, border ${winner.palette?.border}
Hero: ${winner.heroArchetype}
Rhythm: ${winner.layoutRhythm}
Motion: ${winner.motionConcept}
Signature: ${winner.signatureDetail}

DIRECTOR'S NOTES (apply these to make it sharper): ${improvements}

Produce the DESIGN SPEC as JSON with EXACTLY this shape (no extra keys):
{
  "concept": string,          // the final art-direction paragraph (the realized winner + notes)
  "vibe": string[],           // 4-6 adjectives
  "palette": { "bg": hex, "surface": hex, "text": hex, "muted": hex, "primary": hex, "primaryContrast": hex, "accent": hex, "border": hex, "invertBg": hex, "invertText": hex },
  "headingFont": { "family": string, "fallback": string, "weights": number[] },
  "bodyFont": { "family": string, "fallback": string, "weights": number[] },
  "typeScale": string,        // the fluid scale in prose: base size, ratio, and clamp() ranges for h1/h2/h3
  "radius": { "sm": string, "md": string, "lg": string, "pill": string },
  "motion": { "concept": string, "reveals": string },   // reveals = which blocks animate in, how, in what order, with what stagger; plus any hero choreography
  "vocabulary": [ { "name": string, "role": string } ],  // THIS site's own classes for layout + components
  "layouts": {                // ordered composition per surface, in prose, using your vocabulary + the core classes
    "front-page": string,
    "archive": string,
    "single": string,
    "page": string,
    "detail": string
  }
}

RULES:
- "invertBg"/"invertText" are for alternating dark bands; still include them even if used lightly (pick a tasteful dark surface + its readable text).
- Real Google Fonts only. Hex colors only. Text-on-bg and text-on-invert must pass WCAG AA.
- VOCABULARY is the site's OWN class names (no leading dot), lowercase-hyphenated, for every layout block and component your design needs: at minimum a page-section wrapper, the front-page hero, at least one content band (and an inverted band if your rhythm uses one), a list/card item for archives, an article wrapper + its lede/body, and an eyebrow/kicker label. Add whatever your signature detail needs. Give each a precise role.
- Do NOT redefine any of these CORE classes — they already exist and you'll style them in CSS, but never list them in "vocabulary":
${coreClassList}
- LAYOUTS: compose each surface as an ordered, specific sequence ("1) full-bleed split hero: … 2) inverted stats band: … 3) asymmetric two-thirds editorial section: …"). Reference ONLY class names that are either in your "vocabulary" or in the CORE list (e.g. container, button, post-thumbnail, reveal). The front-page must be the richest — at least 4 distinct, rhythmically varied sections. Archive/single/page/detail should be distinctive too, not bare.
- Every class you name in a layout MUST be defined in "vocabulary" (or be a CORE class). Keep the vocabulary tight — invent classes you will actually use.

Return only the JSON.`;
  return { system, user };
}

// ─── 2d. Stylesheet ─────────────────────────────────────────────────────────
function vocabList(vocab: VocabClass[]): string {
  return vocab.map((v) => `  .${v.name} — ${v.role}`).join("\n");
}

const CSS_OUTPUT_RULES = `Output ONLY raw CSS — no markdown, no code fences, no JSON, no commentary. Do NOT include the WordPress "/*! Theme Name ... */" header comment or any @import (fonts load via <link>).`;

export function stylesheetPrompt(brief: Brief, spec: DesignSpec): { system: string; user: string } {
  const system = `${ART_DIRECTOR_SYSTEM}

You are now writing the COMPLETE stylesheet that realizes an already-decided design system. ${CSS_OUTPUT_RULES}`;

  const p = spec.palette;
  const user = `${briefContext(brief)}

DESIGN SYSTEM TO REALIZE (do not invent a different palette, fonts or vocabulary):
Concept: ${spec.concept}
Palette: bg ${p.bg}, surface ${p.surface}, text ${p.text}, muted ${p.muted}, primary ${p.primary}, primaryContrast ${p.primaryContrast}, accent ${p.accent}, border ${p.border}, invertBg ${p.invertBg}, invertText ${p.invertText}
Heading font: "${spec.headingFont.family}" (${spec.headingFont.fallback}); Body font: "${spec.bodyFont.family}" (${spec.bodyFont.fallback})
Type scale: ${spec.typeScale}
Radius: sm ${spec.radius.sm}, md ${spec.radius.md}, lg ${spec.radius.lg}, pill ${spec.radius.pill}
Motion: ${spec.motion.concept} — ${spec.motion.reveals}

Write the complete stylesheet:
1. ":root" with custom properties for every palette color (incl. invert), both font stacks, the radius scale, a spacing scale (--space-1 … --space-8), a fluid type scale, a max content width, and 1-2 shadow tokens. Reference these vars throughout — never hard-code a hex that's already a token.
2. A modern reset + expressive base element styles: html/body, links, headings in the heading font using the FLUID scale (clamp()), paragraphs, lists, responsive images, blockquote, code, tables, hr. Base prose must look designed on its own (the_content() output relies on it).
3. Style EVERY core class below (they are emitted by the theme's PHP/JS — all must be styled, coherently with the concept):
${coreClassList}
4. Style EVERY class in this site's vocabulary, realizing the intended composition (asymmetry, bands, overlap — not a generic centered stack):
${vocabList(spec.vocabulary)}
5. MOTION contract (exact, non-negotiable — this is how the reveal script and its failsafe work):
   - .reveal opts a block into scroll-reveal. Author the hidden→shown transition, but the hidden state MUST be scoped under html.js so a no-JS visitor sees everything:
       html.js .reveal { opacity: 0; transform: <your entrance transform>; transition: opacity <dur> <easing>, transform <dur> <easing>; }
       html.js .reveal.is-visible { opacity: 1; transform: none; }
   - Reduced motion resets it: @media (prefers-reduced-motion: reduce) { html.js .reveal { opacity: 1; transform: none; transition: none; } }
   - You MAY add stagger, hero entrance animation and hover motion beyond this, but NEVER hide anything that isn't .reveal, and never hide .reveal outside html.js.
6. An inverted band treatment (using invertBg/invertText) for any dark section your layouts call for, with correct contrast for text, links and buttons inside it.
7. Mobile-first responsive rules (~768px, and a wider ~1024px where the composition needs it): .main-navigation collapses behind .menu-toggle on mobile and shows inline on desktop (.nav-menu.toggled-on reveals it); multi-column compositions reflow gracefully to one column. Nothing overflows on small screens.
8. Classic WordPress content states: .wp-caption, .alignleft/.alignright/.aligncenter, .sticky, .gallery, and comment-list basics.
9. Interaction polish: :focus-visible outlines using the accent, tasteful hover transitions on links/buttons/cards/nav.

Make it genuinely art-directed and specific to this brand. Output the raw CSS now.`;
  return { system, user };
}

// ─── 2e. Motion script ──────────────────────────────────────────────────────
const MOTION_RULES = `HARD RULES for the script (a broken script must never break the page or hide content):
- Output ONLY raw JavaScript — no markdown, no code fences, no <script> tags, no HTML, no commentary.
- One IIFE. Wrap the whole body in try/catch so any failure is swallowed silently.
- NO libraries, NO network of any kind, NO fetch/XMLHttpRequest/WebSocket, NO eval/new Function, NO document.write, NO import/require, NO string containing "</" or "http". Vanilla DOM only.
- The theme sets <html class="js"> before paint and the CSS hides .reveal only under html.js. Your job is to add the class "is-visible" to each .reveal when it enters the viewport.
- Respect motion preferences: if matchMedia('(prefers-reduced-motion: reduce)') matches, immediately add is-visible to every .reveal and return (no animation).
- If IntersectionObserver is unavailable, immediately add is-visible to every .reveal and return.
- Otherwise observe every .reveal; when it intersects, add is-visible (optionally a small per-element style.transitionDelay for stagger within a group) and unobserve it.
- You may also choreograph the hero on DOMContentLoaded/load using your own classes or data-attributes — but NEVER hide content that is not .reveal, and never leave a .reveal hidden.
- Keep it under ~2.5KB. Runnable as-is in a browser.`;

export function motionPrompt(brief: Brief, spec: DesignSpec): { system: string; user: string } {
  const system = `You are a front-end engineer who writes small, bulletproof vanilla-JS motion. You care about performance, accessibility and never shipping a script that can white-screen a page. ${MOTION_RULES}`;
  const user = `${briefContext(brief)}

Design concept: ${spec.concept}
Motion direction to implement: ${spec.motion.concept}
Reveal choreography: ${spec.motion.reveals}

Write the presentational-motion script that realizes this choreography via the .reveal → .is-visible contract (plus any hero flourish). Output ONLY the JavaScript.`;
  return { system, user };
}

// ─── 2f. Critique ───────────────────────────────────────────────────────────
export function critiquePrompt(
  brief: Brief,
  spec: DesignSpec,
  css: string,
  js: string
): { system: string; user: string } {
  const system = `You are a ruthless senior design critic doing a code-level review of a theme's stylesheet and motion script. You have seen a thousand generic AI sites and you call out every place this one drifts toward that. You are specific: you cite selectors and give the exact fix. You do not invent problems — if it's genuinely strong, you say ship.`;
  const user = `${briefContext(brief)}

Intended concept: ${spec.concept}
Type scale: ${spec.typeScale}
Motion: ${spec.motion.concept}

STYLESHEET:
${css}

MOTION SCRIPT:
${js || "(no motion script)"}

Critique against: typographic ambition & hierarchy, spacing/rhythm & dynamism, palette use & contrast (WCAG AA), the reveal contract being correctly html.js-gated with a reduced-motion reset, AI-slop patterns (everything centered, identical cards, timid type, generic shadows), and whether the CSS actually delivers the intended composition. Return JSON:
{
  "verdict": "revise" | "ship",
  "cssPatchNeeded": boolean,
  "jsPatchNeeded": boolean,
  "issues": [ { "area": "typography"|"rhythm"|"color"|"contrast"|"motion"|"slop"|"coverage", "severity": "high"|"med"|"low", "detail": string, "fix": string } ]
}
List issues most-severe first; keep to the ones that actually matter. Only JSON.`;
  return { system, user };
}

function issueLines(issues: { area: string; severity: string; detail: string; fix: string }[]): string {
  return issues
    .map((i) => `- [${i.severity}] ${i.area}: ${i.detail}\n  FIX: ${i.fix}`)
    .join("\n");
}

// ─── 2g. Revise ─────────────────────────────────────────────────────────────
export function reviseStylesheetPrompt(
  brief: Brief,
  spec: DesignSpec,
  css: string,
  issues: { area: string; severity: string; detail: string; fix: string }[]
): { system: string; user: string } {
  const system = `${ART_DIRECTOR_SYSTEM}

You are revising an existing stylesheet to fix a critic's issues WITHOUT losing what already works or breaking the class coverage. ${CSS_OUTPUT_RULES}`;
  const user = `${briefContext(brief)}

Concept: ${spec.concept}

The current stylesheet has these issues to fix:
${issueLines(issues)}

Here is the current stylesheet — return the COMPLETE revised stylesheet (keep every selector that exists now, apply the fixes, preserve the .reveal html.js-gated motion contract and the reduced-motion reset):

${css}

Output the raw revised CSS now.`;
  return { system, user };
}

export function reviseMotionPrompt(
  brief: Brief,
  spec: DesignSpec,
  js: string,
  issues: { area: string; severity: string; detail: string; fix: string }[]
): { system: string; user: string } {
  const system = `You are a front-end engineer revising a vanilla-JS motion script to fix review issues. ${MOTION_RULES}`;
  const user = `Motion direction: ${spec.motion.concept} — ${spec.motion.reveals}

Fix these issues in the script:
${issueLines(issues)}

Current script — return the COMPLETE revised script honoring the .reveal → .is-visible contract:

${js}

Output ONLY the JavaScript.`;
  return { system, user };
}

// ─── Class-coverage repair (after the template fan-out) ─────────────────────
export function classPatchPrompt(
  spec: DesignSpec,
  css: string,
  missing: string[]
): { system: string; user: string } {
  const system = `You are a CSS engineer adding coherent styles for a few classes that a theme's templates use but the stylesheet never defined. You match the existing design system exactly, reusing its CSS custom properties. ${CSS_OUTPUT_RULES}`;
  const user = `The theme's design concept: ${spec.concept}
Palette tokens exist as CSS vars (e.g. var(--color-primary) / var(--primary), var(--space-*)). Match the existing look.

These class selectors are USED in the templates but are MISSING from the stylesheet, so they render unstyled:
${missing.map((c) => `  .${c}`).join("\n")}

Return ONLY a small block of additional CSS that styles each missing class coherently with the system (sensible spacing, type, color from the existing tokens). Do not restyle anything else. Output the raw CSS to append.`;
  return { system, user };
}
