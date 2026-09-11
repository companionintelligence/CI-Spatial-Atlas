/**
 * Programmatic access to the small CI token contract used by the WebGL layers
 * (Cesium materials, React-Three-Fiber colors) that cannot read CSS custom
 * properties. Keep this in lockstep with `atlas-tokens.css`.
 */
type Mode = 'light' | 'dark';

export const tokens = {
  light: { primary: { hex: '#0a6358' } },
  dark: { primary: { hex: '#c5e8dc' } },
} as const;

/** CI phthalo `--primary` for the given mode (default dark, the viewer's default). */
export function primaryHex(mode: Mode = 'dark'): string {
  return tokens[mode].primary.hex;
}

/** The canonical Manrope font stack. */
export const fontStack = 'Manrope, system-ui, sans-serif';
