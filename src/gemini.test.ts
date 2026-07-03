import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImagePrompt } from "./gemini";
import type { DesignSystem } from "./types";

// The content LLM decides WHAT the image shows (in context, next to the copy
// it wrote); the design system decides HOW it looks. buildImagePrompt is the
// deterministic composition of the two.

const design = {
    artDirection: "Sun-drenched Mediterranean coastal photography, deep blues",
    vibe: ["serene", "adventurous"],
    palette: { primary: "#134e6f", accent: "#f26419" },
} as unknown as DesignSystem;

test("buildImagePrompt combines the content spec with the design direction", () => {
    const p = buildImagePrompt(
        { prompt: "A diver silhouetted against a sunlit cave opening", alt: "x" },
        design
    );
    assert.ok(p.startsWith("A diver silhouetted against a sunlit cave opening"));
    assert.ok(p.includes("Sun-drenched Mediterranean coastal photography"));
    assert.ok(p.includes("serene, adventurous"));
});

test("buildImagePrompt always appends the hard constraints", () => {
    const p = buildImagePrompt({ prompt: "A reef", alt: "x" }, design);
    assert.ok(/no text/i.test(p));
    assert.ok(/no watermarks/i.test(p));
    assert.ok(/no logos/i.test(p));
});

test("buildImagePrompt tolerates a design with no art direction or vibe", () => {
    const p = buildImagePrompt(
        { prompt: "A boat at dawn", alt: "x" },
        { artDirection: "", vibe: [] } as unknown as DesignSystem
    );
    assert.ok(p.startsWith("A boat at dawn"));
    assert.ok(!p.includes("undefined"));
});
