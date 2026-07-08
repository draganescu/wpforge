// The "eyes" of `wpforge fix`. GLM has no vision, so a Gemini vision model
// looks at each rendered screenshot and reports GLARING, objective layout
// defects as structured JSON. We reuse the existing GEMINI_API_KEY / @google/genai
// dependency (already used for featured images) so no new vendor is introduced.
import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { extractJson, stripCodeFence } from "./util";

export interface VisualDefect {
  /** which template surface it appeared on (filled in by the caller) */
  surface: string;
  severity: "high" | "med" | "low";
  /** short category: layout | contrast | overflow | spacing | typography | broken | image */
  area: string;
  /** what's visibly wrong */
  description: string;
  /** the likely CSS cause, in a few words */
  cause: string;
}

export interface VisionOpts {
  apiKey: string;
  /** a vision-capable Gemini model, e.g. "gemini-2.5-flash" */
  model: string;
}

const DIAGNOSE_SYSTEM = `You are a meticulous web-design QA reviewer with a sharp eye for GLARING, objective CSS defects — the kind anyone would call a bug, not a matter of taste. Everything you report will be fixed with CSS ONLY, so report only things CSS can fix.

Report ONLY clear, visible, CSS-fixable problems, such as:
- text that is unreadable: too low contrast against its background, or invisible (same color as background)
- content overflowing off the screen, cut off by a container, or causing a horizontal scrollbar
- elements overlapping or colliding so text/controls are obscured
- a block that is obviously unstyled (raw bullet list, default serif, no spacing) where the rest of the page is designed
- an image rendered enormous or distorted by CSS
- navigation or buttons that are visually broken (collapsed, unstyled, mispositioned)

Do NOT report:
- that content, text, images, or posts appear MISSING, EMPTY, or that an area is blank — that is a content/data issue, NOT a CSS defect, and CSS cannot add content. Ignore empty regions entirely.
- broken-image placeholder icons (missing image files — not CSS).
- matters of taste (font choice, "could be bolder", color preferences, whitespace opinions).

If the page has no glaring CSS defect, return an empty list. Be precise about WHERE on the page and the likely CSS cause.`;

export class VisionModel {
  private ai: GoogleGenAI;
  private model: string;

  constructor(opts: VisionOpts) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  /** Diagnose one screenshot. Returns [] on a clean page or on any parse/call
   *  failure (a fix pass should degrade gracefully, never crash). */
  async diagnose(
    imagePath: string,
    ctx: { surface: string; viewport: string; palette?: Record<string, string> }
  ): Promise<VisualDefect[]> {
    const data = fs.readFileSync(imagePath).toString("base64");
    const paletteLine = ctx.palette
      ? `\nIntended palette (hex): ${Object.entries(ctx.palette).map(([k, v]) => `${k} ${v}`).join(", ")}.`
      : "";
    const prompt = `This is a ${ctx.viewport} screenshot of the "${ctx.surface}" page of a WordPress site.${paletteLine}

Find GLARING visual defects only. Return JSON exactly:
{ "defects": [ { "severity": "high"|"med"|"low", "area": string, "description": string, "cause": string } ] }
Empty array if the page looks fine. Only JSON.`;

    try {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType: "image/png", data } }, { text: prompt }],
          },
        ],
        config: { systemInstruction: DIAGNOSE_SYSTEM, temperature: 0.2 },
      });
      const text = res.text ?? "";
      const parsed = extractJson<{ defects?: Omit<VisualDefect, "surface">[] }>(text);
      return (parsed.defects ?? []).map((d) => ({
        surface: ctx.surface,
        severity: d.severity === "high" || d.severity === "med" ? d.severity : "low",
        area: d.area ?? "layout",
        description: d.description ?? "",
        cause: d.cause ?? "",
      }));
    } catch {
      return [];
    }
  }

  /** Author a CSS override patch — multimodally. Gemini is shown the broken
   *  SCREENSHOTS and the theme's current stylesheet together, so the same model
   *  that sees each defect also writes the fix (no lossy hand-off to a blind
   *  coder). Returns raw CSS to append, or "" on any failure. */
  async authorFix(params: {
    concept: string;
    currentCss: string;
    items: { surface: string; imagePath: string; defects: VisualDefect[] }[];
  }): Promise<string> {
    // Cap the number of images per call to bound cost/latency.
    const items = params.items.slice(0, 6);
    const parts: Array<Record<string, unknown>> = [];
    for (const it of items) {
      const data = fs.readFileSync(it.imagePath).toString("base64");
      parts.push({ inlineData: { mimeType: "image/png", data } });
      parts.push({
        text:
          `Screenshot of the "${it.surface}" page. Glaring defects to fix here:\n` +
          it.defects
            .map((d) => `- [${d.severity}] (${d.area}) ${d.description}${d.cause ? ` — likely CSS cause: ${d.cause}` : ""}`)
            .join("\n"),
      });
    }
    parts.push({
      text: `Theme concept: ${params.concept}

Here is the theme's CURRENT stylesheet. Find the selectors responsible for the defects you can see in the screenshots above, and write minimal overrides that fix them — reuse these variables and selectors, do NOT rewrite the sheet:

${params.currentCss}

Return ONLY the CSS override block to append after this stylesheet.`,
    });

    try {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: { systemInstruction: FIX_SYSTEM, temperature: 0.2 },
      });
      return stripCodeFence(res.text ?? "").trim();
    } catch {
      return "";
    }
  }
}

const FIX_SYSTEM = `You are a senior CSS engineer fixing GLARING, objective visual defects in a rendered WordPress theme. You are shown SCREENSHOTS of the broken pages together with the theme's current stylesheet, so you can see each defect AND find the exact selector responsible for it.

You write minimal, surgical CSS OVERRIDES (to be appended after the current stylesheet) that fix exactly the reported defects and nothing else. Rules:
- Output ONLY raw CSS — no markdown, no code fences, no commentary.
- Fix ONLY the listed defects (contrast/readability, overflow, overlap, unstyled blocks, mis-sized elements). Do not restyle anything not flagged.
- Reuse the theme's existing CSS custom properties (var(--...)) and match its aesthetic. Target the real selectors you find in the stylesheet.
- Keep specificity just high enough to win as an override. Balanced braces, valid CSS only.`;
