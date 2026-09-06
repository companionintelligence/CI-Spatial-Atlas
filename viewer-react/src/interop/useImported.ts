/**
 * Holds whatever the user has imported this session and merges it into the
 * story the renderers draw.
 *
 * Deliberately **in memory only**, unlike the scrapbook draft next door in
 * `scrapbook/useScrapbook.ts`. A dropped GeoJSON is routinely tens of megabytes;
 * `localStorage` caps out somewhere around 5 MB per origin and throws
 * `QuotaExceededError` on the write, which would mean a successful-looking
 * import that silently vanishes on reload. Persisting imports properly means
 * IndexedDB or saving into Companion Memory, and "save this into your memory"
 * is a deliberate act with a visible button, not something an import should do
 * behind the user's back.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Item, Story } from '@companion-atlas/story';
import type { ImportedFile } from './importFile.js';

export interface ImportedState {
  /** Every item currently merged into the view, in import order. */
  items: Item[];
  /** One entry per file, for the "what did I just add" list. */
  files: ImportedFile[];
  add: (files: ImportedFile[]) => void;
  removeFile: (fileName: string) => void;
  clear: () => void;
}

export function useImported(): ImportedState {
  const [files, setFiles] = useState<ImportedFile[]>([]);

  const add = useCallback((incoming: ImportedFile[]) => {
    // Keep the failures: the panel lists them, and a file that failed is
    // exactly the one the user wants to see named.
    setFiles((prev) => [...prev, ...incoming]);
  }, []);

  const removeFile = useCallback((fileName: string) => {
    setFiles((prev) => prev.filter((f) => f.fileName !== fileName));
  }, []);

  const clear = useCallback(() => setFiles([]), []);

  const items = useMemo(() => files.flatMap((f) => f.items), [files]);

  return { items, files, add, removeFile, clear };
}

/**
 * Merge imported items into a story for rendering.
 *
 * Returns the original object when there is nothing to merge, so the common
 * case doesn't hand the renderer a new object identity every render — the
 * Cesium viewer rebuilds its CZML data source when the story reference
 * changes, and doing that on every frame would be visible.
 *
 * Ids are made unique on the way in (`safeIdPrefix` in `importFile.ts` derives
 * a prefix per file), so a collision here means the same file was imported
 * twice. That is a legitimate thing to do — the later copy wins in any id-keyed
 * lookup — so this drops the earlier duplicate rather than rendering two
 * entities that fight over the same id.
 */
export function withImported(story: Story | null, items: readonly Item[]): Story | null {
  if (!story || items.length === 0) return story;

  const seen = new Set<string>();
  const merged: Item[] = [];
  // Later wins, so walk backwards and reverse — cheaper than a lookup pass.
  for (const item of [...(story.items ?? []), ...items].reverse()) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  merged.reverse();

  return { ...story, items: merged };
}

/** Human summary for the panel and for a toast: "42 places from 2 files". */
export function summarise(files: readonly ImportedFile[]): string {
  const ok = files.filter((f) => !f.error);
  const count = ok.reduce((n, f) => n + f.items.length, 0);
  const failed = files.length - ok.length;

  const parts: string[] = [];
  if (count) parts.push(`${count} ${count === 1 ? 'feature' : 'features'} from ${ok.length} ${ok.length === 1 ? 'file' : 'files'}`);
  else if (ok.length) parts.push(`${ok.length} ${ok.length === 1 ? 'file' : 'files'} with nothing locatable in ${ok.length === 1 ? 'it' : 'them'}`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ') || 'Nothing imported';
}
