import { useEffect, useState } from 'react';
import { fetchStreetView, streetViewAvailable, type StreetViewShot } from '../memory/streetview.js';
import type { AtlasMemory } from '../model/atlasModel.js';

/**
 * What the lookup knows about a memory's place.
 *
 * "There is no panorama here" and "we haven't looked yet" used to be the same
 * value — `null` — so a caller could only ever drop the imagery silently, and
 * the absence read as a hole in the panel rather than a fact about the place.
 * Plenty of real places have no coverage: indoors, private land, rural roads.
 * That is worth saying out loud, and saying it needs the two apart.
 */
export type StreetViewStatus =
  /** Nothing was asked: no API key, no memory, or no coordinates. */
  | 'idle'
  | 'checking'
  /** Google has imagery of this spot. */
  | 'found'
  /** Google has none. Not an error — the common case for indoor memories. */
  | 'none';

export interface StreetViewPeek {
  shot: StreetViewShot | null;
  status: StreetViewStatus;
}

export interface StreetViewOptions {
  /** Picture size in pixels; the Static API caps each side at 640. */
  width?: number;
  height?: number;
}

/** Street View of a memory's place, and whether there is any to be had. */
export function useStreetView(memory: AtlasMemory | null, opts: StreetViewOptions = {}): StreetViewPeek {
  const [peek, setPeek] = useState<StreetViewPeek>({ shot: null, status: 'idle' });
  const { width, height } = opts;
  const id = memory?.id;
  const lat = memory?.lat;
  const lon = memory?.lon;

  useEffect(() => {
    if (lat == null || lon == null || !streetViewAvailable()) {
      setPeek({ shot: null, status: 'idle' });
      return;
    }
    setPeek({ shot: null, status: 'checking' });
    let cancelled = false;
    // Deliberately no AbortSignal, though `fetchStreetView` accepts one. It
    // caches per ~11 m cell and shares a single request between callers, and an
    // abort arrives inside that shared request as "no panorama" — which is then
    // cached. Scrubbing quickly through memories would permanently blank Street
    // View for every place passed over, for every caller, for the whole session.
    // One extra free metadata call is much the cheaper mistake.
    void fetchStreetView(lat, lon, { width, height }).then((shot) => {
      if (!cancelled) setPeek({ shot, status: shot ? 'found' : 'none' });
    });
    return () => {
      cancelled = true;
    };
  }, [id, lat, lon, width, height]);

  return peek;
}
