import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreviewBlueprint, previewTargets } from "./preview";

test("buildPreviewBlueprint activates theme then plugins in order, logs in, lands on admin", () => {
  const bp = buildPreviewBlueprint("acme", ["acme-content-model", "acme-contact-form", "acme-seed"]);
  assert.equal(bp.login, true);
  assert.equal(bp.landingPage, "/wp-admin/");
  // theme is activated before any plugin
  const activate = bp.steps.filter((s) => s.step === "activateTheme" || s.step === "activatePlugin");
  assert.deepEqual(activate, [
    { step: "activateTheme", themeFolderName: "acme" },
    { step: "activatePlugin", pluginPath: "acme-content-model/acme-content-model.php" },
    { step: "activatePlugin", pluginPath: "acme-contact-form/acme-contact-form.php" },
    { step: "activatePlugin", pluginPath: "acme-seed/acme-seed.php" },
  ]);
  // ships an mu-plugin that hides the admin bar from screenshots
  assert.ok(bp.steps.some((s) => s.step === "writeFile" && String(s.path).includes("mu-plugins")));
});

test("previewTargets covers each template surface with plain-permalink-safe URLs", () => {
  const t = previewTargets(["class"]);
  const surfaces = t.map((x) => x.surface);
  assert.ok(surfaces.includes("front-page"));
  assert.ok(surfaces.includes("front-page (mobile)"));
  assert.ok(surfaces.includes("archive"));
  assert.ok(surfaces.includes("search"));
  assert.ok(surfaces.includes("404"));
  assert.ok(surfaces.includes("page"));
  assert.ok(surfaces.includes("single"));
  assert.ok(surfaces.includes("archive-class"));
  assert.ok(surfaces.includes("single-class"));
  // static URLs use ?query args so they resolve under WordPress default permalinks
  const archive = t.find((x) => x.surface === "archive")!;
  assert.equal(archive.url, "/?author=1");
  const cptArchive = t.find((x) => x.surface === "archive-class")!;
  assert.equal(cptArchive.url, "/?post_type=class");
  // single is derived by navigation (no known slug/id up front)
  const single = t.find((x) => x.surface === "single")!;
  assert.ok(single.derive && !single.url);
});

test("previewTargets without custom post types still covers the core surfaces", () => {
  const surfaces = previewTargets([]).map((x) => x.surface);
  assert.ok(surfaces.includes("front-page"));
  assert.ok(surfaces.includes("single"));
  assert.ok(!surfaces.some((s) => s.startsWith("archive-")));
  assert.ok(!surfaces.some((s) => s.startsWith("single-")));
});

test("mobile front-page target uses the mobile viewport", () => {
  const m = previewTargets([]).find((x) => x.surface === "front-page (mobile)")!;
  assert.equal(m.viewport.label, "mobile");
  assert.ok(m.viewport.width < 500);
});
