/**
 * Entity-id conventions for the drawing layer.
 *
 * The globe's layers identify themselves by an id prefix rather than by which
 * `DataSource` a pick came from — `mem:` for memory pins, `place:` for named
 * places (`CesiumStoryViewer`), and the ones below for anything the drawing
 * tools own. One `scene.pick` plus one parse tells you which layer was hit and
 * what part of it, which is what lets a single click handler serve selection,
 * vertex dragging and shape moving without three overlapping handlers fighting
 * over the same canvas.
 *
 * Kept in its own module, free of Cesium, so the parse is unit-tested. It looks
 * too simple to test right up until an id containing a colon (`draw:line:2`, or
 * a memory id from an upstream system) makes `split(':')[1]` return the wrong
 * half — hence `indexOf`-based parsing everywhere below, never `split`.
 */

/** A committed drawn item's main entity. */
export const ITEM_PREFIX = 'authoring:';
/** A polygon's separately-drawn outline — see `entities.ts` for why. */
export const OUTLINE_PREFIX = 'authoring-outline:';
/** A draggable vertex handle on the selected item. Suffix is the vertex index. */
export const VERTEX_PREFIX = 'authoring-vertex:';
/** The "move the whole shape" handle at the selected item's anchor. */
export const MOVE_HANDLE_ID = 'authoring-move';
/** Transient preview geometry. Never selectable. */
export const DRAFT_LINE_ID = 'authoring-draft-line';
export const DRAFT_FILL_ID = 'authoring-draft-fill';
export const DRAFT_VERTEX_PREFIX = 'authoring-draft-vertex:';

/** The other layers' prefixes, so selection can round-trip through one model. */
export const MEMORY_PREFIX = 'mem:';
export const PLACE_PREFIX = 'place:';

export type PickedTarget =
  | { kind: 'item'; id: string }
  | { kind: 'vertex'; index: number }
  | { kind: 'move' }
  | { kind: 'draft' }
  | { kind: 'memory'; id: string }
  | { kind: 'place'; id: string };

const after = (value: string, prefix: string): string => value.slice(prefix.length);

/**
 * Classify a picked entity id.
 *
 * Order matters: `authoring-outline:` and `authoring-vertex:` both start with
 * `authoring`, but not with `authoring:` — the colon in `ITEM_PREFIX` is what
 * keeps them apart, and it is why the item prefix is `authoring:` rather than
 * the tidier-looking `authoring-`.
 */
export function parsePickedId(entityId: string | null | undefined): PickedTarget | null {
  if (typeof entityId !== 'string' || entityId === '') return null;

  if (entityId === MOVE_HANDLE_ID) return { kind: 'move' };
  if (entityId === DRAFT_LINE_ID || entityId === DRAFT_FILL_ID) return { kind: 'draft' };
  if (entityId.startsWith(DRAFT_VERTEX_PREFIX)) return { kind: 'draft' };

  if (entityId.startsWith(VERTEX_PREFIX)) {
    const index = Number.parseInt(after(entityId, VERTEX_PREFIX), 10);
    return Number.isInteger(index) && index >= 0 ? { kind: 'vertex', index } : null;
  }
  // An outline is part of its polygon, not a thing of its own — clicking the
  // edge of a shape selects the shape, which is what a user expects and what
  // makes a 0-opacity (outline-only) polygon selectable at all.
  if (entityId.startsWith(OUTLINE_PREFIX)) {
    const id = after(entityId, OUTLINE_PREFIX);
    return id ? { kind: 'item', id } : null;
  }
  if (entityId.startsWith(ITEM_PREFIX)) {
    const id = after(entityId, ITEM_PREFIX);
    return id ? { kind: 'item', id } : null;
  }
  if (entityId.startsWith(MEMORY_PREFIX)) {
    const id = after(entityId, MEMORY_PREFIX);
    return id ? { kind: 'memory', id } : null;
  }
  if (entityId.startsWith(PLACE_PREFIX)) {
    const id = after(entityId, PLACE_PREFIX);
    return id ? { kind: 'place', id } : null;
  }
  return null;
}

export const itemEntityId = (id: string): string => `${ITEM_PREFIX}${id}`;
export const outlineEntityId = (id: string): string => `${OUTLINE_PREFIX}${id}`;
export const vertexEntityId = (index: number): string => `${VERTEX_PREFIX}${index}`;
export const draftVertexEntityId = (index: number): string => `${DRAFT_VERTEX_PREFIX}${index}`;
