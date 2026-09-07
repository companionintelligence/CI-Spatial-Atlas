import { useEffect, useState } from 'react';
import type { Place } from '@companion-atlas/story';
import { fetchPlaces, type MemorySource } from '../memory/client.js';

/**
 * Load named Places from Companion Memory. Unlike `useStory()`, there's no
 * bundled-sample fallback — Places only exist when connected to a live
 * CI-Server (`memory`, from `useStory()`'s own `?memory=`/env resolution), so
 * this hook is a no-op (empty roster) while viewing an offline/shared story.
 *
 * `importFromMemory()` (`src/memory/import.ts`) already returns a place roster
 * — a *better* one, since it also covers places the events reference but
 * `places()` didn't return. When a screen runs a full import, pass that roster
 * in as `provided` instead of letting this hook issue a second, redundant
 * `places()` query for the same rows.
 */
export function usePlaces(
  memory: MemorySource | null,
  provided?: Place[] | null,
): {
  places: Place[];
  placesLoading: boolean;
  placesError: string | null;
} {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A caller-supplied roster short-circuits the fetch entirely (including the
    // `null` memory case, so a story loaded from a file can still carry the
    // places it was exported with).
    if (provided) {
      setPlaces(provided);
      setError(null);
      return;
    }
    if (!memory) {
      setPlaces([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPlaces(memory)
      .then((p) => { if (!cancelled) setPlaces(p); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory?.url, memory?.token, provided]);

  return { places, placesLoading: loading, placesError: error };
}
