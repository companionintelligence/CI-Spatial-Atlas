import { useEffect, useState } from 'react';
import { loadStory, type Story } from '@companion-atlas/story';
import { fetchMemoryStory } from '../memory/client.js';
import { nativeMemoryUrl, storedMemoryToken } from '../memory/auth.js';
import { memoryCredentialsAllowed } from '../embed/index.js';
import { companionHubFromEnv, discoverCompanionResources, type CompanionLlm, type CompanionResources } from '../discovery/companion.js';
import { finishPortalSignIn } from '../auth/portalReturn.js';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

/** The Companion Hub this build discovers from, or null. Set with VITE_COMPANION_HUB_URL. */
const COMPANION_HUB = companionHubFromEnv(env);

export type StorySource = 'memory' | 'story';

/** What the Companion Hub reported, when the build names one. */
export interface CompanionState {
  hub: string;
  /** True when the Hub published a Memory server. */
  memory: boolean;
  /** An LLM resource the Hub published. It is recorded only: nothing calls it yet. */
  llm: CompanionLlm | null;
}

/**
 * Load the 4D unit the globe renders. Two sources:
 *  - **Companion Memory** (real data): `?memory=<ci-server-url>` (optionally
 *    `&token=<jwt>` or `&apiKey=<key>`) or the `VITE_MEMORY_URL`,
 *    `VITE_MEMORY_TOKEN` / `VITE_MEMORY_API_KEY` env vars, or the short-lived
 *    token from the in-viewer sign-in, or the connection a native shell saved
 *    at its last sign-in —
 *    queries CI-Server's located `search()` and maps it to a Story. With none of
 *    those set, and `VITE_COMPANION_HUB_URL` set, the Memory server is discovered
 *    from the Companion Hub (docs/DISCOVERY.md).
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
  memory: { url: string; token?: string; apiKey?: string } | null;
  /** The Companion Hub's discovery, when the build names a Hub. Null otherwise. */
  companion: CompanionState | null;
} {
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSample, setIsSample] = useState(false);
  // Set when the load resolves to a Memory server the Hub named, so the shell reports the
  // connection the viewer actually made, not only the build's configuration.
  const [resolved, setResolved] = useState<{ source: StorySource; memory: { url: string; token?: string; apiKey?: string } } | null>(null);
  const [companion, setCompanion] = useState<CompanionState | null>(null);

  const params = new URLSearchParams(window.location.search);
  // An iframe's `src` is written by the *embedding* page, so in embed mode
  // every parameter is attacker-supplied: `?embed=1&memory=https://evil&token=…`
  // would point Atlas at a server of the embedder's choosing, with credentials,
  // inside a frame they control — and the viewer would faithfully connect. An
  // embed renders `?story=` or the bundled sample and nothing else.
  //
  // Environment variables are unaffected: those are the deployment's own
  // choice, not something a third-party page can write.
  const urlCredentials = memoryCredentialsAllowed(window.location.search);
  const memoryParam = urlCredentials ? params.get('memory') : null;
  // An address in the URL or the build is an explicit choice. The Companion Hub (below)
  // comes next, then a native shell's saved connection, which main.tsx restores before this
  // hook runs. Portal and Hub discovery stay the primary path.
  const configuredMemoryUrl = memoryParam ?? env.VITE_MEMORY_URL;
  const memoryUrl = configuredMemoryUrl ?? nativeMemoryUrl();
  // A URL supplied in the address bar is an explicit connection choice. Do not
  // silently combine it with credentials baked into a different deployment:
  // that is especially dangerous for `?memory=/memory`, where the intended
  // credential is the same-origin CI-Server session cookie. A caller can still
  // opt into a bearer/key explicitly with `?token=` or `?apiKey=`.
  const sessionToken = memoryUrl ? storedMemoryToken(memoryUrl) : undefined;
  const memoryToken = (urlCredentials ? params.get('token') : null) ?? sessionToken ?? (memoryParam == null ? env.VITE_MEMORY_TOKEN : undefined);
  const memoryApiKey = (urlCredentials ? params.get('apiKey') : null) ?? (memoryParam == null ? env.VITE_MEMORY_API_KEY : undefined);
  const source: StorySource = memoryUrl ? 'memory' : 'story';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // A Portal sign-in that just came back is finished first, so its token is in
        // place before the Memory request is made.
        await finishPortalSignIn(env);
        let s: Story;
        const explicit = params.get('story');
        // Nothing configured: ask the Companion Hub where the Memory server is. Only when
        // the build names a Hub, and never over an explicit `?story=`.
        let discovered: CompanionResources | null = null;
        if (!configuredMemoryUrl && !explicit && COMPANION_HUB) {
          discovered = await discoverCompanionResources(COMPANION_HUB);
        }
        if (!cancelled && COMPANION_HUB) {
          setCompanion({ hub: COMPANION_HUB, memory: Boolean(discovered?.memory), llm: discovered?.llm ?? null });
        }
        const target = configuredMemoryUrl ?? discovered?.memory?.url ?? memoryUrl ?? null;
        if (target) {
          // A configured Memory keeps its build credentials, read again after the Portal
          // return above. A discovered or saved Memory gets only the token this tab signed in
          // with for that exact server, never the build's own token or API key.
          const urlToken = urlCredentials ? params.get('token') : null;
          const token = configuredMemoryUrl
            ? (urlToken ?? storedMemoryToken(target) ?? (memoryParam == null ? env.VITE_MEMORY_TOKEN : undefined))
            : storedMemoryToken(target);
          const apiKey = configuredMemoryUrl ? memoryApiKey : undefined;
          // Reported before the request, so a load that fails still names the Memory it
          // tried: the load screen offers sign-in for that server.
          if (!cancelled) setResolved({ source: 'memory', memory: { url: target, token, apiKey } });
          s = await fetchMemoryStory({ url: target, token, apiKey });
        } else {
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

  return {
    story,
    error,
    loading,
    source: resolved?.source ?? source,
    isSample,
    memory: resolved?.memory ?? (memoryUrl ? { url: memoryUrl, token: memoryToken, apiKey: memoryApiKey } : null),
    companion,
  };
}
