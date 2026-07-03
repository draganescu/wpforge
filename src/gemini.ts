// Thin image-generation client for Google's Gemini image models (Nano Banana
// family). Mirrors the shape of cerebras.ts: retries with backoff, per-call
// metrics, and no opinions about what to do with the bytes. The content model
// decides WHAT each image shows (SeedImageSpec, written in context with the
// copy); buildImagePrompt composes that with the design system's art
// direction so every image on the site shares one look.
import { GoogleGenAI } from "@google/genai";
import type { DesignSystem, SeedImageSpec } from "./types";

export interface GeminiOpts {
  apiKey: string;
  /** e.g. "gemini-3.1-flash-lite-image" (Nano Banana 2 Lite) */
  model: string;
}

export interface ImageResult {
  data: Buffer;
  mimeType: string;
  ms: number;
}

/** Compose the content model's in-context image description with the design
 *  system's aesthetic, plus hard constraints that apply to every image. */
export function buildImagePrompt(spec: SeedImageSpec, design: DesignSystem): string {
  const parts = [spec.prompt.trim()];
  if (design.artDirection) {
    parts.push(`Style: ${design.artDirection.trim()}`);
  }
  if (design.vibe?.length) {
    parts.push(`Mood: ${design.vibe.join(", ")}`);
  }
  parts.push("Photographic, natural lighting. No text, no watermarks, no logos, no borders.");
  return parts.join(". ").replace(/\.\./g, ".");
}

export class GeminiImages {
  private ai: GoogleGenAI;
  private model: string;

  constructor(opts: GeminiOpts) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  /** Generate one image. Retries transient failures; throws after 3 attempts. */
  async generate(prompt: string, aspectRatio = "16:9"): Promise<ImageResult> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const started = Date.now();
      try {
        const interaction = await this.ai.interactions.create({
          model: this.model,
          input: prompt,
          response_format: {
            type: "image",
            mime_type: "image/jpeg",
            aspect_ratio: aspectRatio as "16:9",
            image_size: "1K",
          },
        });
        const image = interaction.output_image;
        if (!image?.data) {
          throw new Error("no image data in response");
        }
        return {
          data: Buffer.from(image.data, "base64"),
          mimeType: image.mime_type ?? "image/jpeg",
          ms: Date.now() - started,
        };
      } catch (e) {
        lastErr = e;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    }
    throw new Error(`Gemini image call failed: ${(lastErr as Error)?.message ?? String(lastErr)}`);
  }
}
