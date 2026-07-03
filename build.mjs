// Bundle the CLI into a single self-contained CommonJS file (needs only `node`,
// no node_modules). The esbuild JS API places the shebang reliably at line 1.
import { build } from "esbuild";
import { chmodSync } from "node:fs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/wpforge.cjs",
  // No banner: esbuild preserves the shebang already on line 1 of src/index.ts.
  logLevel: "info",
});

chmodSync("dist/wpforge.cjs", 0o755);
console.log("✓ bundled → dist/wpforge.cjs");
