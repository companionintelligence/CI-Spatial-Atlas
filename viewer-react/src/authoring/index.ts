/**
 * Authoring — create, edit and delete on the globe.
 *
 * Companion Atlas could render a story and had no way to make one. These are
 * the tools that close that gap: click to place a marker or a note, click-click-
 * double-click to draw a line or an area, select a shape to move it, reshape it,
 * restyle it or delete it, and capture the current camera as a `Camera` a scene
 * can fly to.
 *
 * Everything produced here is a canonical `Item` from `@companion-atlas/story`.
 * There is no parallel geometry model and no parallel style store, which is what
 * makes a drawn shape exportable to KML, renderable in WebXR, and collectable
 * into a scrapbook without anything else being taught about it.
 *
 * ## The split
 *
 *   geometry.ts     plane geometry — intersection, area, length (no deps)
 *   draft.ts        the drawing state machine (no deps)
 *   gesture.ts      the two input rules that decide what a click means
 *   store.ts        the item list, selection model, and merge back into a Story
 *   style.ts        the tool's style, and how it lands on canonical fields
 *   icons.ts        the marker icon gallery
 *   camera.ts       camera pose ↔ canonical `Camera` (units live here)
 *   ids.ts          entity-id conventions shared with the memory/place layers
 *   persist.ts      the drawn set in localStorage, scoped per account
 *   ------------------------------------------------------------------------
 *   pick.ts         pixel → terrain position                        (Cesium)
 *   entities.ts     `Item` → Cesium entities                        (Cesium)
 *   controller.ts   `createAuthoringController(viewer, …)`          (Cesium)
 *   useAuthoring.ts the React binding                        (Cesium + React)
 *   Toolbar.tsx     the panel                                        (React)
 *
 * The line in the middle is the same one `layers/index.ts` draws, and for the
 * same reason: everything above it is unit-tested in node with no DOM and no
 * WebGL, and re-exporting the Cesium modules from here would drag the whole
 * Cesium bundle into anything that touches the model — including the tests and
 * the XR renderer.
 *
 * So: **import `./authoring/controller.js` and `./authoring/useAuthoring.js`
 * directly** from the viewer. Everything else comes from here.
 */
export * from './geometry.js';
export * from './gesture.js';
export * from './draft.js';
export * from './store.js';
export * from './style.js';
export * from './icons.js';
export * from './camera.js';
export * from './ids.js';
export * from './persist.js';
export { AuthoringToolbar, formatArea, formatLength, type AuthoringToolbarProps } from './Toolbar.js';
