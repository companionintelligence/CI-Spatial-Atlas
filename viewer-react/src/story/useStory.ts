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
export function useStory(): {
  story: Story | null;
  error: string | null;
  loading: boolean;
  source: StorySource;
  /**
   * True when the globe is showing the bundled demo story because nothing real
   * was configured. The UI must say so — synthetic places rendered with no
   * marking are indistinguishable from real memories, which reads as a fake
   * product rather than a disconnected one.
   */
  isSample: boolean;
  /** The connected Companion Memory (for write-back), or null when offline. */
  memory: { url: string; token?: string } | null;
} {
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSample, setIsSample] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const memoryUrl = params.get('memory') ?? env.VITE_MEMORY_URL;
  const memoryToken = params.get('token') ?? env.VITE_MEMORY_TOKEN;
  const source: StorySource = memoryUrl ? 'memory' : 'story';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let s: Story;
        if (memoryUrl) {
          s = await fetchMemoryStory({ url: memoryUrl, token: memoryToken });
        } else {
          const explicit = params.get('story');
          const url = explicit ?? '/stories/sample-pacific-journey.json';
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          s = loadStory(await res.json());
          // No `?story=` and no memory source means we fell back to the bundled
          // demo. Flag it so the shell can label it rather than passing fixtures
          // off as the user's own memories.
          if (!explicit && !cancelled) setIsSample(true);
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

  return { story, error, loading, source, isSample, memory: memoryUrl ? { url: memoryUrl, token: memoryToken } : null };
}
