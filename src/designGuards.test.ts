import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateCss,
  missingClasses,
  validateMotionJs,
  usedClasses,
  unknownTemplateClasses,
} from "./designGuards";

// A minimal but gate-passing stylesheet: :root, balanced braces, >=20 rules.
function bigCss(): string {
  const rules = [":root{--x:1}"];
  for (let i = 0; i < 40; i++) rules.push(`.r${i}{color:var(--x);padding:8px;margin:0;display:block}`);
  return rules.join("\n") + "\n".padEnd(1600, " ");
}

test("validateCss accepts a real stylesheet", () => {
  assert.equal(validateCss(bigCss()).ok, true);
});

test("validateCss rejects the truncated/degenerate 22-line case", () => {
  const tiny = ":root{--x:1}.a{color:red}";
  const r = validateCss(tiny);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /too short/);
});

test("validateCss rejects unbalanced braces", () => {
  const css = bigCss() + " .broken{color:red";
  const r = validateCss(css);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /unbalanced/);
});

test("validateCss rejects a sheet with no :root", () => {
  let css = "";
  for (let i = 0; i < 40; i++) css += `.r${i}{color:red;padding:8px;margin:0;display:block}\n`;
  css = css.padEnd(1600, " ");
  const r = validateCss(css);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /:root/);
});

test("missingClasses finds declared classes the CSS never styled", () => {
  const css = ".hero-split{}.eyebrow{}";
  assert.deepEqual(missingClasses(css, ["hero-split", "eyebrow", "feature-band"]), ["feature-band"]);
});

test("missingClasses: a declared base is covered by a BEM selector in the CSS", () => {
  // design declares the base "card"; the stylesheet styles ".card__title" —
  // the base is found as the selector's prefix, so it is not reported missing.
  assert.deepEqual(missingClasses(".card__title{color:red}", ["card"]), []);
});

test("missingClasses does not let .card cover .cardigan", () => {
  const css = ".card{}";
  assert.deepEqual(missingClasses(css, ["cardigan"]), ["cardigan"]);
});

test("validateMotionJs accepts a clean IntersectionObserver script", () => {
  const js =
    "(function(){try{var e=document.querySelectorAll('.reveal');" +
    "if(!('IntersectionObserver' in window)){return;}" +
    "var o=new IntersectionObserver(function(x){});o.observe(e[0]);}catch(e){}})();";
  assert.equal(validateMotionJs(js).ok, true);
});

test("validateMotionJs rejects a script-tag breakout", () => {
  const r = validateMotionJs("var s='</script><img>';");
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /breakout/);
});

test("validateMotionJs rejects network access", () => {
  assert.equal(validateMotionJs("fetch('/x').then(function(){});").ok, false);
  assert.equal(validateMotionJs("var u='https://evil.example';").ok, false);
});

test("validateMotionJs rejects eval and syntax errors", () => {
  assert.equal(validateMotionJs("eval('1');").ok, false);
  assert.equal(validateMotionJs("function(){").ok, false);
});

test("validateMotionJs treats empty as invalid (drop → static site)", () => {
  assert.equal(validateMotionJs("   ").ok, false);
});

test("usedClasses extracts literal tokens and skips PHP interpolation", () => {
  const html = '<div class="hero-split reveal"><span class="meta <?php echo $x; ?>">';
  const set = usedClasses(html);
  assert.equal(set.has("hero-split"), true);
  assert.equal(set.has("reveal"), true);
  assert.equal(set.has("meta"), true);
  // the interpolated token is skipped, not captured as a bogus class
  assert.equal([...set].some((c) => c.includes("php")), false);
});

test("unknownTemplateClasses flags invented classes but allows core + WP-native", () => {
  const tpl = '<main class="site-content container"><div class="wp-block invented-thing eyebrow align-left">';
  const unknown = unknownTemplateClasses([tpl], ["site-content", "container", "eyebrow"]);
  assert.deepEqual(unknown, ["invented-thing"]);
});
