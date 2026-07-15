import { useEffect, useState } from 'react';
import { loadStory, type Story } from '@companion-atlas/story';

/**
 * Load a Story from `?story=<url>`. `loadStory` accepts BOTH legacy shapes
 * (Companion-Atlas `Story` and CI-Earth-2 `Scrapbook`), so any previously
 * published document keeps working.
 */
export function useStory(): { story: Story | null; error: string | null; loading: boolean } {
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('story');
    if (!url) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = await res.json();
        if (!cancelled) setStory(loadStory(doc));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { story, error, loading };
}
