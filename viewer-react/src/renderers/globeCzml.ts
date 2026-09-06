/**
 * Which CZML packets the globe draws itself, and which the memory-pin layer
 * already stands in for.
 *
 * Extracted from `CesiumStoryViewer` so the rule is testable without a DOM or a
 * WebGL context. It is worth testing: the previous version of this filter was a
 * one-liner that silently dropped every drawn shape and every imported KML or
 * GeoJSON feature, and nothing caught it because the import path was correct at
 * every other layer — the features were parsed, merged into the story, and
 * exported back to KML faithfully. They were simply never rendered.
 */

/** The subset of a CZML packet this decision reads. */
export interface CzmlLike {
  id?: unknown;
  path?: unknown;
  model?: unknown;
  polyline?: unknown;
  polygon?: unknown;
  point?: unknown;
  billboard?: unknown;
}

/**
 * `passthroughIds` are story items with no scene of their own. `deriveModel`
 * builds the memory list from `story.scenes`, so an item that no scene
 * references has no pin representing it — dropping its packet here would mean
 * it never appears at all.
 */
export function keepForGlobe(packet: CzmlLike, passthroughIds: ReadonlySet<string>): boolean {
  // The document packet carries the clock. Without it the viewer has no
  // timeline to scrub.
  if (packet.id === 'document') return true;

  // Authored tracks and 3D models have never had a pin equivalent.
  if (packet.path !== undefined || packet.model !== undefined) return true;

  // Neither has any drawn geometry: the pin layer draws points and its own
  // journey route, never a story's polylines or polygons.
  if (packet.polyline !== undefined || packet.polygon !== undefined) return true;

  // Anything else — points, billboards, labels — is a located memory the pin
  // layer redraws interactively, unless it is one of the sceneless items above.
  return packet.id !== undefined && passthroughIds.has(String(packet.id));
}
