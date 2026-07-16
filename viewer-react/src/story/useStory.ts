import { useEffect, useState } from 'react';
import { loadStory, type Story } from '@companion-atlas/story';
import { fetchMemoryStory } from '../memory/client.js';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

export type StorySource = 'memory' | 'story';

/**
 * Load the 4D unit the globe renders. Two sources:
 *  - **Companion Memory** (real data): `?memory=<ci-server-url>` (optionally
 *    `&token=<jwt>`) or the `VITE_MEMORY_URL` / `VITE_MEMORY_TOKEN` env vars —
 *    queries CI-Server's located `search()` and maps it to a Story.
 *  - **A published Story**: `?story=<url>` (accepts legacy Atlas + Earth-2
 *    documents), falling back to the bundled sample so the viewer renders out of
 *    the box.
 */
export function useStory(): { story: Story | null; error: string | null; loading: boolean; source: StorySource } {
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const params = new URLSearchParams(window.location.search);
  const memoryUrl = params.get('memory') ?? env.VITE_MEMORY_URL;
  const source: StorySource = memoryUrl ? 'memory' : 'story';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let s: Story;
        if (memoryUrl) {
          const token = params.get('token') ?? env.VITE_MEMORY_TOKEN;
          s = await fetchMemoryStory({ url: memoryUrl, token });
        } else {
          const url = params.get('story') ?? '/stories/sample-pacific-journey.json';
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          s = loadStory(await res.json());
        }
        if (!cancelled) setStory(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { story, error, loading, source };
}
