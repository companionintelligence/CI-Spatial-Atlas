/**
 * Scene authoring — writing the story, rather than drawing on it.
 *
 * Atlas could already present a deck (`buildDeck`, `Presenter`, `SceneLayout`)
 * and could already capture a camera pose, and there was nowhere to put one.
 * This is the authoring surface's model: an ordered list of canonical `Scene`s,
 * the operations that build and reorder it, the check that says whether it can
 * still be exported, and its account-scoped persistence.
 *
 * ## The one rule
 *
 * Authored scenes reach a `Story` through `withAuthoredScenes` (or
 * `SceneControl.toStory`) and through **nothing else** — and only on the way
 * out of the app, or into the presenter's own deck. Handing a story that
 * carries them to `deriveModel` or `CesiumStoryViewer` collapses the globe to
 * one pin per scene: see the header of `story.ts` for the mechanism. This is
 * the same separation the drawing tools keep, where the controller renders its
 * own shapes and `mergeAuthoredItems` folds them in for export only.
 *
 * ## The split
 *
 *   model.ts      ids, creation, patching, ordering, validation (no React)
 *   sceneMedia.ts which story entities can back a slide; narration URL checks
 *   persist.ts    the deck in localStorage, scoped per account
 *   story.ts      the export-only merge into a canonical `Story`
 *   useScenes.ts  the React binding (state + persistence + operations)
 *
 * Everything except the hook is pure and DOM-free, which is what lets the rules
 * that can be silently wrong be unit-tested in node — the same line
 * `layers/index.ts` and `authoring/index.ts` draw.
 */
export * from './model.js';
export * from './sceneMedia.js';
export * from './persist.js';
export * from './story.js';
export * from './useScenes.js';
