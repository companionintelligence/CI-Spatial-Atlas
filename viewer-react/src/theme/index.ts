/**
 * Programmatic access to the CI canonical tokens for the WebGL layers (Cesium
 * materials, React-Three-Fiber colors) that can't read CSS custom properties.
 * Values track @companionintelligence/tokens (CI-Common) via the vendored
 * `tokens.json`.
 */
import tokens from './tokens.json';

type Mode = 'light' | 'dark';

/** CI teal `--primary` for the given mode (default dark, the viewer's default). */
export function primaryHex(mode: Mode = 'dark'): string {
  return tokens[mode].primary.hex;
}

/** The canonical Montserrat font stack. */
export const fontStack = '"Montserrat", system-ui, -apple-system, sans-serif';

export { tokens };
