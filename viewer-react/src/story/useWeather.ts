import { useEffect, useState } from 'react';
import { fetchMemoryWeather, type MemoryWeather } from '../memory/weather.js';
import type { AtlasMemory } from '../model/atlasModel.js';

/** Historical weather for the focused memory; null while unknown or unavailable. */
export function useWeather(memory: AtlasMemory | null): MemoryWeather | null {
  const [weather, setWeather] = useState<MemoryWeather | null>(null);

  useEffect(() => {
    setWeather(null);
    if (!memory || memory.lat == null || memory.lon == null) return;
    const ac = new AbortController();
    let cancelled = false;
    void fetchMemoryWeather(memory.lat, memory.lon, memory.timeMs, ac.signal).then((w) => {
      if (!cancelled) setWeather(w);
    });
    return () => { cancelled = true; ac.abort(); };
  }, [memory?.id, memory?.lat, memory?.lon, memory?.timeMs]);

  return weather;
}
