// Builds the special "seed" plugin: a self-contained classic plugin that, once
// activated, inserts all generated sample content (pages, posts, CPT items),
// wires up the primary menu, and sets the front page / blog index. Content is
// embedded as base64 JSON to avoid any quoting/delimiter hazards, and every
// insert is idempotent (marked with _wpforge_seed meta) so re-activation is safe.
import type { GeneratedPlugin, SeedData, ThemeContract } from "./types";
import { fn } from "./placeholder";

export function buildSeedPlugin(seed: SeedData, contract: ThemeContract): GeneratedPlugin {
  const prefix = fn(contract); // php-safe function prefix
  const slug = `${contract.themeSlug}-seed`;
  const name = `${contract.themeName} — Sample Content Seeder`;
  const b64 = Buffer.from(JSON.stringify(seed), "utf8").toString("base64");
  const hasImages = !!seed.images?.length;

  // Attachment machinery, emitted only when the seeder bundles images.
  const attachFn = !hasImages
    ? ""
    : `
/**
 * Sideload one bundled image into the media library and set it as the
 * featured image of $post_id. Idempotent: keyed by a _wpforge_seed marker,
 * and skipped entirely when the post already has a thumbnail.
 *
 * @param int    $post_id Target post.
 * @param string $file    Path relative to this plugin's directory.
 * @param string $alt     Attachment alt text.
 * @param string $marker  Unique seed marker for the attachment.
 */
function ${prefix}_attach_image( $post_id, $file, $alt, $marker ) {
	if ( ! $post_id || has_post_thumbnail( $post_id ) ) {
		return;
	}
	$existing = get_posts( array(
		'post_type'   => 'attachment',
		'meta_key'    => '_wpforge_seed',
		'meta_value'  => $marker,
		'post_status' => 'any',
		'numberposts' => 1,
		'fields'      => 'ids',
	) );
	if ( ! empty( $existing ) ) {
		set_post_thumbnail( $post_id, (int) $existing[0] );
		return;
	}
	if ( false !== strpos( $file, '..' ) ) {
		return;
	}
	$path = plugin_dir_path( __FILE__ ) . $file;
	if ( ! file_exists( $path ) ) {
		return;
	}
	$bits = wp_upload_bits( basename( $file ), null, file_get_contents( $path ) );
	if ( ! empty( $bits['error'] ) ) {
		return;
	}
	$type   = wp_check_filetype( $bits['file'] );
	$att_id = wp_insert_attachment( array(
		'post_mime_type' => $type['type'],
		'post_title'     => sanitize_text_field( $alt ),
		'post_status'    => 'inherit',
	), $bits['file'], $post_id );
	if ( is_wp_error( $att_id ) || ! $att_id ) {
		return;
	}
	require_once ABSPATH . 'wp-admin/includes/image.php';
	wp_update_attachment_metadata( $att_id, wp_generate_attachment_metadata( $att_id, $bits['file'] ) );
	update_post_meta( $att_id, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );
	update_post_meta( $att_id, '_wpforge_seed', $marker );
	set_post_thumbnail( $post_id, $att_id );
}
`;

  const attachLoop = !hasImages
    ? ""
    : `
	// Featured images bundled with the seeder.
	foreach ( (array) ( isset( $data['images'] ) ? $data['images'] : array() ) as $img ) {
		$target = sanitize_key( $img['target'] );
		$islug  = sanitize_title( $img['slug'] );
		$ptype  = in_array( $target, array( 'page', 'post' ), true ) ? $target : sanitize_key( $target );
		if ( ! post_type_exists( $ptype ) ) {
			continue;
		}
		$owner_marker = $target . ':' . $islug;
		$owner = get_posts( array(
			'post_type'   => $ptype,
			'meta_key'    => '_wpforge_seed',
			'meta_value'  => $owner_marker,
			'post_status' => 'any',
			'numberposts' => 1,
			'fields'      => 'ids',
		) );
		if ( empty( $owner ) ) {
			continue;
		}
		${prefix}_attach_image( (int) $owner[0], $img['file'], $img['alt'], 'image:' . $owner_marker );
	}
`;

  const php = `<?php
/**
 * Plugin Name: ${name}
 * Description: One-time seeding of demo pages, posts, custom content, the primary menu and front-page settings. Safe to re-activate (idempotent). To re-seed from scratch, delete the "${prefix}_seeded" option.
 * Version: 1.0.0
 * Requires PHP: 8.1
 *
 * @package ${contract.themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

register_activation_hook( __FILE__, function () {
	update_option( '${prefix}_seed_pending', '1' );
} );

add_action( 'admin_init', '${prefix}_maybe_seed', 99 );

/**
 * Decode the embedded seed payload.
 *
 * @return array
 */
function ${prefix}_seed_data() {
	$json = base64_decode( '${b64}' );
	$data = json_decode( $json, true );
	return is_array( $data ) ? $data : array();
}

/**
 * Run the seed once, guarded by an option flag.
 */
function ${prefix}_maybe_seed() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	if ( get_option( '${prefix}_seeded' ) ) {
		return;
	}
	if ( ! get_option( '${prefix}_seed_pending' ) ) {
		return;
	}
	$data = ${prefix}_seed_data();
	if ( empty( $data ) ) {
		return;
	}
	${prefix}_run_seed( $data );
	update_option( '${prefix}_seeded', '1' );
	delete_option( '${prefix}_seed_pending' );
	add_action( 'admin_notices', function () {
		echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( 'Sample content seeded successfully.', '${contract.textDomain}' ) . '</p></div>';
	} );
}

/**
 * Idempotent insert keyed by a unique seed marker.
 *
 * @param array  $args   wp_insert_post args.
 * @param string $marker Unique marker.
 * @return int Post ID (0 on failure).
 */
function ${prefix}_insert_once( $args, $marker ) {
	$existing = get_posts( array(
		'post_type'   => $args['post_type'],
		'meta_key'    => '_wpforge_seed',
		'meta_value'  => $marker,
		'post_status' => 'any',
		'numberposts' => 1,
		'fields'      => 'ids',
	) );
	if ( ! empty( $existing ) ) {
		return (int) $existing[0];
	}
	$id = wp_insert_post( $args, true );
	if ( is_wp_error( $id ) || ! $id ) {
		return 0;
	}
	update_post_meta( $id, '_wpforge_seed', $marker );
	return (int) $id;
}
${attachFn}
/**
 * Perform the seeding.
 *
 * @param array $data Decoded payload.
 */
function ${prefix}_run_seed( $data ) {
	if ( ! empty( $data['options']['blogname'] ) ) {
		update_option( 'blogname', sanitize_text_field( $data['options']['blogname'] ) );
	}
	if ( ! empty( $data['options']['blogdescription'] ) ) {
		update_option( 'blogdescription', sanitize_text_field( $data['options']['blogdescription'] ) );
	}

	// Categories.
	$cat_ids = array();
	foreach ( (array) ( isset( $data['categories'] ) ? $data['categories'] : array() ) as $cat_name ) {
		$term = term_exists( $cat_name, 'category' );
		if ( ! $term ) {
			$term = wp_insert_term( $cat_name, 'category' );
		}
		if ( ! is_wp_error( $term ) ) {
			$cat_ids[ $cat_name ] = (int) ( is_array( $term ) ? $term['term_id'] : $term );
		}
	}

	// Blog posts.
	foreach ( (array) ( isset( $data['posts'] ) ? $data['posts'] : array() ) as $post ) {
		$id = ${prefix}_insert_once( array(
			'post_type'    => 'post',
			'post_status'  => 'publish',
			'post_title'   => wp_strip_all_tags( $post['title'] ),
			'post_name'    => sanitize_title( $post['slug'] ),
			'post_content' => wp_kses_post( $post['content'] ),
			'post_excerpt' => sanitize_text_field( isset( $post['excerpt'] ) ? $post['excerpt'] : '' ),
		), 'post:' . $post['slug'] );
		if ( ! $id ) {
			continue;
		}
		$ids = array();
		foreach ( (array) ( isset( $post['categories'] ) ? $post['categories'] : array() ) as $c ) {
			if ( isset( $cat_ids[ $c ] ) ) {
				$ids[] = $cat_ids[ $c ];
			}
		}
		if ( $ids ) {
			wp_set_post_categories( $id, $ids );
		}
		if ( ! empty( $post['tags'] ) ) {
			wp_set_post_tags( $id, array_map( 'sanitize_text_field', (array) $post['tags'] ) );
		}
	}

	// Pages + front page / blog index.
	$page_ids = array();
	foreach ( (array) ( isset( $data['pages'] ) ? $data['pages'] : array() ) as $page ) {
		$id = ${prefix}_insert_once( array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => wp_strip_all_tags( $page['title'] ),
			'post_name'    => sanitize_title( $page['slug'] ),
			'post_content' => wp_kses_post( $page['content'] ),
			'menu_order'   => isset( $page['menuOrder'] ) ? (int) $page['menuOrder'] : 0,
		), 'page:' . $page['slug'] );
		if ( ! $id ) {
			continue;
		}
		$page_ids[ sanitize_title( $page['slug'] ) ] = $id;
		if ( ! empty( $page['isFrontPage'] ) ) {
			update_option( 'show_on_front', 'page' );
			update_option( 'page_on_front', $id );
		}
		if ( ! empty( $page['isBlogIndex'] ) ) {
			update_option( 'page_for_posts', $id );
		}
	}

	// Custom post type items (only if the content-model plugin registered them).
	foreach ( (array) ( isset( $data['cptItems'] ) ? $data['cptItems'] : array() ) as $item ) {
		$pt = sanitize_key( $item['postType'] );
		if ( ! post_type_exists( $pt ) ) {
			continue;
		}
		$id = ${prefix}_insert_once( array(
			'post_type'    => $pt,
			'post_status'  => 'publish',
			'post_title'   => wp_strip_all_tags( $item['title'] ),
			'post_name'    => sanitize_title( $item['slug'] ),
			'post_content' => wp_kses_post( $item['content'] ),
			'post_excerpt' => sanitize_text_field( isset( $item['excerpt'] ) ? $item['excerpt'] : '' ),
		), $pt . ':' . $item['slug'] );
		if ( ! $id ) {
			continue;
		}
		foreach ( (array) ( isset( $item['meta'] ) ? $item['meta'] : array() ) as $k => $v ) {
			update_post_meta( $id, sanitize_key( $k ), is_numeric( $v ) ? $v + 0 : sanitize_text_field( $v ) );
		}
		foreach ( (array) ( isset( $item['terms'] ) ? $item['terms'] : array() ) as $tax => $terms ) {
			$tax = sanitize_key( $tax );
			if ( taxonomy_exists( $tax ) ) {
				wp_set_object_terms( $id, array_map( 'sanitize_text_field', (array) $terms ), $tax );
			}
		}
	}

${attachLoop}
	// Primary menu.
	if ( ! empty( $data['menu']['items'] ) ) {
		$menu_name = sanitize_text_field( $data['menu']['name'] );
		$menu      = wp_get_nav_menu_object( $menu_name );
		$menu_id   = $menu ? (int) $menu->term_id : wp_create_nav_menu( $menu_name );
		if ( ! is_wp_error( $menu_id ) ) {
			$existing = wp_get_nav_menu_items( $menu_id );
			if ( empty( $existing ) ) {
				foreach ( $data['menu']['items'] as $mi ) {
					$mslug = sanitize_title( $mi['slug'] );
					if ( isset( $page_ids[ $mslug ] ) ) {
						wp_update_nav_menu_item( $menu_id, 0, array(
							'menu-item-title'     => sanitize_text_field( $mi['title'] ),
							'menu-item-object'    => 'page',
							'menu-item-object-id' => $page_ids[ $mslug ],
							'menu-item-type'      => 'post_type',
							'menu-item-status'    => 'publish',
						) );
					}
				}
			}
			$location  = sanitize_key( $data['menu']['location'] );
			$locations = get_theme_mod( 'nav_menu_locations', array() );
			$locations[ $location ] = (int) $menu_id;
			set_theme_mod( 'nav_menu_locations', $locations );
		}
	}

	flush_rewrite_rules();
}
`;

  return { slug, name, files: [{ path: `${slug}.php`, content: php }] };
}
