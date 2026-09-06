/**
 * The Atlas layer system.
 *
 * Import from here, not from the individual modules — the split below is about
 * what can be tested without a DOM, not about what callers should know:
 *
 *   model.ts      pure data + list operations (no React, no Cesium, no storage)
 *   sniff.ts      "what is this URL, and can we draw it" + human error messages
 *   catalog.ts    the built-in open-data catalog, with its licences
 *   store.ts      account-scoped localStorage persistence
 *   story.ts      round-trip through the canonical `@companion-atlas/story` Layer
 *   useLayers.ts  the React binding (state + persistence + operations)
 *   cesium.ts     the scene adapter — the only file here that needs WebGL
 *
 * `cesium.ts` is deliberately *not* re-exported: pulling it in would drag the
 * whole Cesium bundle into anything that touches the model, including the tests
 * and the XR renderer. Import `./layers/cesium.js` directly from the viewer.
 */
export * from './model.js';
export * from './sniff.js';
export * from './catalog.js';
export * from './store.js';
export * from './story.js';
export * from './useLayers.js';
