import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeedPlugin } from "./seed";
import type { SeedData, ThemeContract } from "./types";

const contract = {
    themeSlug: "testsite",
    themeName: "Testsite",
    textDomain: "testsite",
    menuLocation: "primary",
    sidebarId: "sidebar-1",
    googleFontsHref: "",
    templateTags: [],
} as unknown as ThemeContract;

function seedData(images?: SeedData["images"]): SeedData {
    return {
        pages: [{ title: "Home", slug: "home", content: "<p>hi</p>" }],
        posts: [],
        cptItems: [],
        categories: [],
        menu: { name: "Primary", location: "primary", items: [] },
        options: { blogname: "Testsite", blogdescription: "" },
        images,
    };
}

test("seed plugin with images emits the sideload/attach machinery", () => {
    const plugin = buildSeedPlugin(
        seedData([{ file: "assets/images/page-home.jpg", target: "page", slug: "home", alt: "A home" }]),
        contract
    );
    const php = plugin.files[0].content;
    assert.ok(php.includes("function testsite_attach_image"));
    assert.ok(php.includes("wp_upload_bits"));
    assert.ok(php.includes("wp_insert_attachment"));
    assert.ok(php.includes("wp_generate_attachment_metadata"));
    assert.ok(php.includes("set_post_thumbnail"));
    assert.ok(php.includes("_wp_attachment_image_alt"));
});

test("attachments are idempotent: marker lookup before sideloading, skip when thumbnail set", () => {
    const plugin = buildSeedPlugin(
        seedData([{ file: "assets/images/page-home.jpg", target: "page", slug: "home", alt: "A home" }]),
        contract
    );
    const php = plugin.files[0].content;
    assert.ok(php.includes("has_post_thumbnail"));
    assert.ok(php.includes("'image:' ."));
    assert.ok(php.includes("_wpforge_seed"));
});

test("image file paths are traversal-guarded in PHP", () => {
    const plugin = buildSeedPlugin(
        seedData([{ file: "assets/images/x.jpg", target: "page", slug: "home", alt: "x" }]),
        contract
    );
    assert.ok(plugin.files[0].content.includes("'..'"));
});

test("seed plugin without images carries no attachment code", () => {
    const plugin = buildSeedPlugin(seedData(undefined), contract);
    const php = plugin.files[0].content;
    assert.ok(!php.includes("wp_upload_bits"));
    assert.ok(!php.includes("attach_image"));
});
