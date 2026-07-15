/**
 * @companionintelligence/tokens — Montserrat typography helpers
 * ============================================================================
 * Montserrat is the canonical Companion Intelligence typeface. Load exactly the
 * five weights below (200 / 400 / 500 / 600 / 700) and nothing more.
 *
 * Environment-aware loading strategy — pick ONE per surface:
 *
 *   1. Networked web apps (has outbound internet, no strict CSP):
 *      inject the Google Fonts <link> — use `googleFontsHref`. This is the
 *      lightest touch and matches CI-Hub's `root.tsx` approach.
 *
 *   2. CSP-restricted, offline, air-gapped, or appliance surfaces
 *      (CI-OS portal, Tauri desktop, JustInCase, kiosk builds):
 *      DO NOT rely on Google Fonts. Self-host instead — install the
 *      `@fontsource/montserrat` weights (or drop woff2 files in) and ship your
 *      own `@font-face` rules so nothing reaches out to a third-party CDN.
 *
 * Either way the CSS font stack stays `MONTSERRAT_STACK`, so components never
 * need to know which loading path a given surface chose.
 * ============================================================================
 */

/** The exact Montserrat weights the CI design system loads. */
export const MONTSERRAT_WEIGHTS = [200, 400, 500, 600, 700] as const;

/** The canonical CSS `font-family` stack (matches `--font-sans`). */
export const MONTSERRAT_STACK = '"Montserrat", system-ui, sans-serif';

/**
 * Google Fonts css2 stylesheet href for the five canonical weights.
 * Use in networked web apps: `<link rel="stylesheet" href={googleFontsHref} />`.
 */
export const googleFontsHref =
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@200;400;500;600;700&display=swap';

export type MontserratWeight = (typeof MONTSERRAT_WEIGHTS)[number];
