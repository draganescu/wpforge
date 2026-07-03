// Deterministic theme helper file (inc/wpforge-helpers.php). Written directly
// (not generated) so the template tags the templates rely on ALWAYS exist and
// behave consistently — including a tasteful, palette-matched vector SVG used
// for every empty image area. Colors are baked in from the design palette.
import type { DesignSystem, ThemeContract } from "./types";

export function helpersPhp(design: DesignSystem, contract: ThemeContract): string {
  const p = design.palette;
  const td = contract.textDomain;
  // Fallbacks keep the SVG valid even if the model omitted a color.
  const bg = p.surface || "#f2efe9";
  const accent = p.accent || "#c8a15a";
  const primary = p.primary || "#1f2a37";
  const muted = p.muted || "#7a7267";
  const border = p.border || "#e2ddd3";

  return `<?php
/**
 * Theme helper template tags for the ${contract.themeName} theme.
 *
 * This file is written by wpforge and is REQUIRED to exist. The template files
 * call these functions; do not redefine them elsewhere.
 *
 * @package ${contract.themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( '${fn(contract)}_placeholder_svg' ) ) :
	/**
	 * Return a themed inline SVG placeholder for empty image areas.
	 *
	 * @param string $label Optional short label drawn in the placeholder.
	 * @return string SVG markup (already escaped/safe to echo).
	 */
	function ${fn(contract)}_placeholder_svg( $label = '' ) {
		$label = trim( wp_strip_all_tags( (string) $label ) );
		if ( strlen( $label ) > 28 ) {
			$label = substr( $label, 0, 27 ) . '…';
		}
		$bg      = '${bg}';
		$accent  = '${accent}';
		$primary = '${primary}';
		$muted   = '${muted}';

		ob_start();
		?>
		<svg class="placeholder-svg" viewBox="0 0 800 450" role="img"
			aria-label="<?php echo esc_attr( $label ? $label : __( 'Image placeholder', '${td}' ) ); ?>"
			xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
			<defs>
				<linearGradient id="pg" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stop-color="<?php echo esc_attr( $bg ); ?>"/>
					<stop offset="1" stop-color="<?php echo esc_attr( $accent ); ?>" stop-opacity="0.16"/>
				</linearGradient>
			</defs>
			<rect width="800" height="450" fill="url(#pg)"/>
			<circle cx="620" cy="120" r="150" fill="<?php echo esc_attr( $accent ); ?>" opacity="0.10"/>
			<g fill="none" stroke="<?php echo esc_attr( $primary ); ?>" stroke-width="6"
				stroke-linecap="round" stroke-linejoin="round" opacity="0.42">
				<circle cx="300" cy="180" r="42" fill="<?php echo esc_attr( $accent ); ?>" fill-opacity="0.5" stroke="none"/>
				<path d="M120 320 L300 200 L430 300 L520 240 L680 340"/>
				<path d="M120 340 H680" opacity="0.5"/>
			</g>
			<?php if ( $label ) : ?>
				<text x="400" y="410" text-anchor="middle"
					font-family="system-ui, sans-serif" font-size="26" font-weight="600"
					fill="<?php echo esc_attr( $muted ); ?>"><?php echo esc_html( $label ); ?></text>
			<?php endif; ?>
		</svg>
		<?php
		return (string) ob_get_clean();
	}
endif;

if ( ! function_exists( '${fn(contract)}_placeholder' ) ) :
	/**
	 * Echo a placeholder inside a .placeholder wrapper (16:9 by default).
	 *
	 * @param string $label   Optional label.
	 * @param string $classes Extra classes for the wrapper.
	 */
	function ${fn(contract)}_placeholder( $label = '', $classes = '' ) {
		printf(
			'<span class="placeholder %s">%s</span>',
			esc_attr( $classes ),
			${fn(contract)}_placeholder_svg( $label ) // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- SVG is built from safe, escaped parts above.
		);
	}
endif;

if ( ! function_exists( '${fn(contract)}_post_thumbnail' ) ) :
	/**
	 * Featured image if present, otherwise the themed vector placeholder.
	 *
	 * @param string $size          Image size.
	 * @param string $wrapper_class Class for the wrapping element.
	 */
	function ${fn(contract)}_post_thumbnail( $size = 'large', $wrapper_class = 'post-thumbnail' ) {
		if ( post_password_required() || is_attachment() ) {
			return;
		}
		if ( has_post_thumbnail() ) {
			echo '<div class="' . esc_attr( $wrapper_class ) . '">';
			the_post_thumbnail( $size, array( 'loading' => 'lazy', 'class' => 'thumb-img' ) );
			echo '</div>';
			return;
		}
		echo '<div class="' . esc_attr( $wrapper_class ) . '">';
		${fn(contract)}_placeholder( get_the_title() );
		echo '</div>';
	}
endif;

if ( ! function_exists( '${fn(contract)}_posted_on' ) ) :
	/**
	 * Byline: publish date (+ author) as .entry-meta.
	 */
	function ${fn(contract)}_posted_on() {
		printf(
			'<div class="entry-meta"><time class="entry-date" datetime="%1$s">%2$s</time><span class="byline"> %3$s %4$s</span></div>',
			esc_attr( get_the_date( DATE_W3C ) ),
			esc_html( get_the_date() ),
			esc_html_x( 'by', 'post author', '${td}' ),
			esc_html( get_the_author() )
		);
	}
endif;

if ( ! function_exists( '${fn(contract)}_entry_footer' ) ) :
	/**
	 * Categories and tags for a single post as .entry-footer.
	 */
	function ${fn(contract)}_entry_footer() {
		if ( 'post' !== get_post_type() ) {
			return;
		}
		$cats = get_the_category_list( esc_html__( ', ', '${td}' ) );
		$tags = get_the_tag_list( '', esc_html__( ', ', '${td}' ) );
		if ( ! $cats && ! $tags ) {
			return;
		}
		echo '<footer class="entry-footer">';
		if ( $cats ) {
			printf( '<span class="cat-links">%1$s %2$s</span>', esc_html__( 'Posted in', '${td}' ), wp_kses_post( $cats ) );
		}
		if ( $tags ) {
			printf( '<span class="tags-links">%1$s %2$s</span>', esc_html__( 'Tagged', '${td}' ), wp_kses_post( $tags ) );
		}
		echo '</footer>';
	}
endif;
`;
}

/** Function prefix derived from the theme slug (php-safe). */
export function fn(contract: ThemeContract): string {
  return contract.themeSlug.replace(/-/g, "_");
}
