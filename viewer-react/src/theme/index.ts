/**
 * Programmatic access to the CI canonical tokens for the WebGL layers (Cesium
 * materials, React-Three-Fiber colors) that can't read CSS custom properties.
 * Values track @companionintelligence/tokens v0.3.
 */
import { tokens, MANROPE_STACK } from '@companionintelligence/tokens';

type Mode = 'light' | 'dark';

/** CI phthalo `--primary` for the given mode (default dark, the viewer's default). */
export function primaryHex(mode: Mode = 'dark'): string {
  return tokens[mode].primary.hex;
}

/** The canonical Manrope font stack. */
export const fontStack = MANROPE_STACK;

export { tokens };
