import { useCallback, useEffect, useState } from 'react';
import type { Visibility } from '@companion-atlas/story';

export interface ScrapbookDraft {
  title: string;
  visibility: Visibility;
  memoryIds: string[];
  /** The Companion has curated this set (narratives + agent provenance). Reset
   *  whenever the set changes, since the curation was written for the old one. */
  curated: boolean;
}

const PREFIX = 'atlas.scrapbook.v1';
const EMPTY: ScrapbookDraft = { title: '', visibility: 'private', memoryIds: [], curated: false };

const keyFor = (scope: string | null) => (scope ? `${PREFIX}:${scope}` : PREFIX);

function read(scope: string | null): ScrapbookDraft {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    if (raw) {
      const p = JSON.parse(raw) as Partial<ScrapbookDraft>;
      // Tolerate hand-edited / older drafts without trusting their shape.
      return {
        title: typeof p.title === 'string' ? p.title : '',
        visibility: p.visibility === 'unlisted' || p.visibility === 'public' ? p.visibility : 'private',
        memoryIds: Array.isArray(p.memoryIds) ? p.memoryIds.filter((x): x is string => typeof x === 'string') : [],
        curated: p.curated === true,
      };
    }
  } catch { /* fresh draft */ }
  return EMPTY;
}

/**
 * The user's scrapbook draft — which memories they've collected, what the
 * journey is called, who may see it, and whether the Companion has curated it.
 * Survives reloads via localStorage.
 *
 * Drafts are **scoped to the story they collect from** (`scope` = the story id).
 * Memory ids are only meaningful within one story, so a single global draft made
 * the rail badge count memories that the current story can't resolve — it
 * claimed "2 collected" over an empty scrapbook after switching to a connected
 * Companion Memory. Scoping keeps each story's draft intact and the count honest.
 */
export function useScrapbook(scope: string | null) {
  const [draft, setDraft] = useState<ScrapbookDraft>(EMPTY);

  // The story id arrives after the async load, so (re)hydrate when scope resolves.
  useEffect(() => {
    setDraft(read(scope));
  }, [scope]);

  useEffect(() => {
    if (!scope) return; // don't persist against the unscoped key
    try { localStorage.setItem(keyFor(scope), JSON.stringify(draft)); } catch { /* quota/private mode */ }
  }, [draft, scope]);

  // Changing the set invalidates any curation written for the previous set.
  const add = useCallback((id: string) => {
    setDraft((d) => (d.memoryIds.includes(id) ? d : { ...d, memoryIds: [...d.memoryIds, id], curated: false }));
  }, []);
  const remove = useCallback((id: string) => {
    setDraft((d) => ({ ...d, memoryIds: d.memoryIds.filter((x) => x !== id), curated: false }));
  }, []);
  const clear = useCallback(() => setDraft((d) => ({ ...EMPTY, visibility: d.visibility })), []);
  const setTitle = useCallback((title: string) => setDraft((d) => ({ ...d, title })), []);
  const setVisibility = useCallback((visibility: Visibility) => setDraft((d) => ({ ...d, visibility })), []);
  const setCurated = useCallback((curated: boolean) => setDraft((d) => ({ ...d, curated })), []);
  const has = useCallback((id: string) => draft.memoryIds.includes(id), [draft.memoryIds]);

  return {
    draft, add, remove, clear, setTitle, setVisibility, setCurated, has,
    count: draft.memoryIds.length,
  };
}
