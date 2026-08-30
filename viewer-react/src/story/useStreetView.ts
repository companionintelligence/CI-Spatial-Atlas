import { useEffect, useState } from 'react';
import { fetchStreetView, type StreetViewShot } from '../memory/streetview.js';
import type { AtlasMemory } from '../model/atlasModel.js';

/** Street View of the focused memory's place; null when there is no panorama. */
export function useStreetView(memory: AtlasMemory | null): StreetViewShot | null {
  const [shot, setShot] = useState<StreetViewShot | null>(null);

  useEffect(() => {
    setShot(null);
    if (!memory || memory.lat == null || memory.lon == null) return;
    const ac = new AbortController();
    let cancelled = false;
    void fetchStreetView(memory.lat, memory.lon, { signal: ac.signal }).then((s) => {
      if (!cancelled) setShot(s);
    });
    return () => { cancelled = true; ac.abort(); };
  }, [memory?.id, memory?.lat, memory?.lon]);

  return shot;
}
