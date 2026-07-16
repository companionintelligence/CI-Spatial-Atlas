import { useCallback, useEffect, useState } from 'react';
import type { Visibility } from '@companion-atlas/story';

export interface ScrapbookDraft {
  title: string;
  visibility: Visibility;
  memoryIds: string[];
}

const KEY = 'atlas.scrapbook.v1';
const EMPTY: ScrapbookDraft = { title: '', visibility: 'private', memoryIds: [] };

/** The user's scrapbook draft — which memories they've collected, what the
 *  journey is called, and who may see it. Survives reloads via localStorage. */
export function useScrapbook() {
  const [draft, setDraft] = useState<ScrapbookDraft>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<ScrapbookDraft>) };
    } catch { /* fresh draft */ }
    return EMPTY;
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* quota/private mode */ }
  }, [draft]);

  const add = useCallback((id: string) => {
    setDraft((d) => (d.memoryIds.includes(id) ? d : { ...d, memoryIds: [...d.memoryIds, id] }));
  }, []);
  const remove = useCallback((id: string) => {
    setDraft((d) => ({ ...d, memoryIds: d.memoryIds.filter((x) => x !== id) }));
  }, []);
  const clear = useCallback(() => setDraft((d) => ({ ...EMPTY, visibility: d.visibility })), []);
  const setTitle = useCallback((title: string) => setDraft((d) => ({ ...d, title })), []);
  const setVisibility = useCallback((visibility: Visibility) => setDraft((d) => ({ ...d, visibility })), []);
  const has = useCallback((id: string) => draft.memoryIds.includes(id), [draft.memoryIds]);

  return { draft, add, remove, clear, setTitle, setVisibility, has, count: draft.memoryIds.length };
}
