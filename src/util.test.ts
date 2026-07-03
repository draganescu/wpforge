import { test } from "node:test";
import assert from "node:assert/strict";
import { hardenNavMenuArgs, hardenPhpCallbacks, placeMissingShortcodes, resolvePageSlug } from "./util";

// Regression: LLM-generated plugins passed PHP built-ins ('floatval') as
// register_post_meta sanitize_callback. WordPress invokes that filter with
// 3-4 arguments, and PHP 8 throws ArgumentCountError for internal functions
// given extra args — a white-screen fatal the moment the meta is written.

test("wraps floatval sanitize_callback in a single-arg closure", () => {
    const php = `register_post_meta(
	'dive_site',
	'max_depth',
	array(
		'type'              => 'number',
		'single'            => true,
		'sanitize_callback' => 'floatval',
		'show_in_rest'      => false,
	)
);`;
    const out = hardenPhpCallbacks(php);
    assert.ok(!out.includes("'sanitize_callback' => 'floatval'"));
    assert.ok(
        out.includes(
            "'sanitize_callback' => static function ( $value ) { return floatval( $value ); }"
        )
    );
});

test("wraps other single-arg PHP builtins regardless of quote style", () => {
    const out = hardenPhpCallbacks(
        `array( "sanitize_callback" => "intval", 'sanitize_callback'=>'trim' )`
    );
    assert.ok(!out.includes('"intval"'));
    assert.ok(out.includes("return intval( $value );"));
    assert.ok(out.includes("return trim( $value );"));
});

test("leaves WordPress userland sanitizers untouched", () => {
    const php = `'sanitize_callback' => 'sanitize_text_field',
'sanitize_callback' => 'sanitize_textarea_field',
'sanitize_callback' => 'absint',
'sanitize_callback' => 'esc_url_raw',`;
    assert.equal(hardenPhpCallbacks(php), php);
});

test("leaves inline uses of builtins alone (only quoted callbacks)", () => {
    const php = `$depth = floatval( $_POST['abyssos_max_depth'] );`;
    assert.equal(hardenPhpCallbacks(php), php);
});

// Regression: the brief model wrote onPage "book-a-dive" while the page slug
// came out "book-dive". pageContentPrompt matched them with ===, so the
// booking form shortcode was never embedded on any page — the plugin worked
// but nothing on the site rendered it.

test("resolvePageSlug: exact match wins", () => {
    assert.equal(resolvePageSlug("contact", ["home", "contact", "contact-us"]), "contact");
});

test("resolvePageSlug: stopword differences resolve (book-a-dive → book-dive)", () => {
    assert.equal(resolvePageSlug("book-a-dive", ["home", "book-dive", "contact"]), "book-dive");
});

test("resolvePageSlug: token subset resolves (contact-us → contact)", () => {
    assert.equal(resolvePageSlug("contact-us", ["home", "contact"]), "contact");
});

test("resolvePageSlug: unrelated slugs do not match", () => {
    assert.equal(resolvePageSlug("pricing", ["home", "about", "contact"]), undefined);
});

test("placeMissingShortcodes: appends missing shortcode to its onPage page", () => {
    const pages = [
        { title: "Home", slug: "home", content: "<p>hi</p>" },
        { title: "Book a Dive", slug: "book-dive", content: "<p>book now</p>" },
    ];
    const features = [
        { key: "booking-system", name: "Booking System", description: "", shortcode: "_booking_form_", onPage: "book-a-dive" },
    ];
    const report = placeMissingShortcodes(pages, features);
    assert.ok(pages[1].content.endsWith("\n\n[_booking_form_]"));
    assert.deepEqual(report.placed, [{ shortcode: "_booking_form_", page: "book-dive" }]);
    assert.deepEqual(report.unplaced, []);
});

test("placeMissingShortcodes: leaves pages alone when shortcode already embedded", () => {
    const pages = [{ title: "Contact", slug: "contact", content: "<p>x</p>\n[_contact_form_]" }];
    const features = [
        { key: "contact-form", name: "Contact Form", description: "", shortcode: "_contact_form_", onPage: "contact" },
    ];
    const before = pages[0].content;
    const report = placeMissingShortcodes(pages, features);
    assert.equal(pages[0].content, before);
    assert.deepEqual(report.placed, []);
});

test("placeMissingShortcodes: falls back to feature key when onPage is missing", () => {
    const pages = [
        { title: "Home", slug: "home", content: "" },
        { title: "Gallery", slug: "gallery", content: "<p>photos</p>" },
    ];
    const features = [
        { key: "dive-gallery", name: "Dive Gallery", description: "", shortcode: "_dive_gallery_" },
    ];
    const report = placeMissingShortcodes(pages, features);
    assert.ok(pages[1].content.includes("[_dive_gallery_]"));
    assert.deepEqual(report.placed, [{ shortcode: "_dive_gallery_", page: "gallery" }]);
});

// Regression: CLASS_VOCAB defines .nav-menu as "the <ul> of the primary menu"
// (the stylesheet model styles it that way), but the header.php model emitted
// 'container_class' => 'nav-menu' — a wrapper div — leaving the real <ul>
// with browser-default bullets and indent.

test("hardenNavMenuArgs: rewrites container_class nav-menu into menu_class on the ul", () => {
    const php = `wp_nav_menu(
	array(
		'theme_location' => 'primary',
		'menu_id'        => 'primary-menu',
		'container_class' => 'nav-menu',
	)
);`;
    const out = hardenNavMenuArgs(php);
    assert.ok(!out.includes("container_class"));
    assert.ok(out.includes("'container' => false, 'menu_class' => 'nav-menu'"));
});

test("hardenNavMenuArgs: no-op when menu_class is already set", () => {
    const php = `wp_nav_menu( array( 'menu_class' => 'nav-menu', 'container_class' => 'nav-wrap' ) );`;
    assert.equal(hardenNavMenuArgs(php), php);
});

test("hardenNavMenuArgs: leaves other container_class values alone", () => {
    const php = `wp_nav_menu( array( 'container_class' => 'footer-menu-wrap' ) );`;
    assert.equal(hardenNavMenuArgs(php), php);
});

test("hardenNavMenuArgs: handles double quotes", () => {
    const out = hardenNavMenuArgs(`wp_nav_menu( array( "container_class" => "nav-menu" ) );`);
    assert.ok(out.includes(`"container" => false, "menu_class" => "nav-menu"`));
});

test("placeMissingShortcodes: reports unplaced when no page matches", () => {
    const pages = [{ title: "Home", slug: "home", content: "" }];
    const features = [
        { key: "newsletter", name: "Newsletter", description: "", shortcode: "_newsletter_", onPage: "signup" },
    ];
    const report = placeMissingShortcodes(pages, features);
    assert.deepEqual(report.placed, []);
    assert.deepEqual(report.unplaced, ["_newsletter_"]);
});
