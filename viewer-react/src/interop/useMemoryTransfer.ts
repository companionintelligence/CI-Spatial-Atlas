/**
 * The Import & export panel's Companion Memory state.
 *
 * Holds one in-flight import and one in-flight export, plus the filter draft
 * and the last result of each. Everything decision-shaped lives next door in
 * `memoryTransfer.ts` (which has no DOM and is under test); this file is
 * deliberately only wiring — React state, an `AbortController`, and the guards
 * that stop a superseded run from writing over a newer one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Story } from '@companion-atlas/story';
import type { MemorySource } from '../memory/client.js';
import type { MemoryImport, MemoryImportProgress } from '../memory/import.js';
import type { MemoryExportProgress, MemoryExportResult } from '../memory/export.js';
import {
  EMPTY_MEMORY_FILTER,
  exportStoryWithReport,
  importFilteredMemory,
  type MemoryFilterDraft,
} from './memoryTransfer.js';

export interface MemoryTransferState {
  /** True when there is a server to talk to at all. */
  connected: boolean;

  filter: MemoryFilterDraft;
  setFilter: (patch: Partial<MemoryFilterDraft>) => void;
  clearFilter: () => void;

  importing: boolean;
  /** The importer's latest tick, or null between runs. */
  progress: MemoryImportProgress | null;
  lastImport: MemoryImport | null;
  /** Why the filter was refused, if it was. Empty once a run starts. */
  problems: string[];
  runImport: () => void;
  cancelImport: () => void;

  exporting: boolean;
  exportProgress: MemoryExportProgress | null;
  lastExport: MemoryExportResult | null;
  runExport: (story: Story) => void;
}

export interface UseMemoryTransferOptions {
  /** Called once per successful *connection* — including an archive that
   *  legitimately turned out to be empty, so the caller can still swap the
   *  story and see the honest "nothing here" state rather than the old one. */
  onImported?: (result: MemoryImport) => void;
  /** Link to store on the exported story event. */
  shareUrl?: () => string | undefined;
}

export function useMemoryTransfer(
  memory: MemorySource | null,
  opts: UseMemoryTransferOptions = {},
): MemoryTransferState {
  const [filter, setFilterState] = useState<MemoryFilterDraft>(EMPTY_MEMORY_FILTER);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<MemoryImportProgress | null>(null);
  const [lastImport, setLastImport] = useState<MemoryImport | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<MemoryExportProgress | null>(null);
  const [lastExport, setLastExport] = useState<MemoryExportResult | null>(null);

  const importCtl = useRef<AbortController | null>(null);
  const exportCtl = useRef<AbortController | null>(null);

  // Callbacks the effects below must not re-run for. `onImported` is typically
  // an inline arrow in the composition root, so depending on its identity would
  // abort a running import on every parent render.
  const onImported = useRef(opts.onImported);
  onImported.current = opts.onImported;
  const shareUrl = useRef(opts.shareUrl);
  shareUrl.current = opts.shareUrl;

  // An unmount mid-import must abort the fetch, or the paging loop keeps going
  // against a component that will never render again — and every `setState` it
  // makes on the way is a warning in the console and a leak in a headset.
  useEffect(() => () => {
    importCtl.current?.abort();
    exportCtl.current?.abort();
  }, []);

  const setFilter = useCallback((patch: Partial<MemoryFilterDraft>) => {
    setFilterState((prev) => ({ ...prev, ...patch }));
    // A changed filter invalidates the complaint about the old one; leaving it
    // on screen reads as "the field I just fixed is still wrong".
    setProblems([]);
  }, []);

  const clearFilter = useCallback(() => {
    setFilterState(EMPTY_MEMORY_FILTER);
    setProblems([]);
  }, []);

  const cancelImport = useCallback(() => {
    importCtl.current?.abort();
  }, []);

  const runImport = useCallback(() => {
    if (!memory) return;
    // Supersede rather than queue: the second click means "not that one, this
    // one", and two paging loops writing the same state interleave into a
    // nonsense progress readout.
    importCtl.current?.abort();
    const ctl = new AbortController();
    importCtl.current = ctl;
    setImporting(true);
    setProblems([]);
    setProgress(null);

    void importFilteredMemory(memory, filter, {
      signal: ctl.signal,
      onProgress: (p) => { if (!ctl.signal.aborted) setProgress(p); },
    }).then((outcome) => {
      if (ctl.signal.aborted) return; // a newer run (or an unmount) owns the state now
      if (!outcome.ok) {
        setProblems(outcome.problems);
        return;
      }
      setLastImport(outcome.result);
      // Hand the caller everything, even a zero-row archive — see `onImported`.
      if (outcome.result.connected) {
        try { onImported.current?.(outcome.result); }
        catch { /* the composition root's problem; the import still succeeded */ }
      }
    }).finally(() => {
      if (importCtl.current === ctl) {
        importCtl.current = null;
        setImporting(false);
      }
    });
  }, [memory, filter]);

  const runExport = useCallback((story: Story) => {
    if (!memory) return;
    exportCtl.current?.abort();
    const ctl = new AbortController();
    exportCtl.current = ctl;
    setExporting(true);
    setExportProgress(null);
    setLastExport(null);

    void exportStoryWithReport(memory, story, {
      signal: ctl.signal,
      // The roster from the last import, when there was one — it carries server
      // place ids the story itself never learned.
      places: lastImport?.places,
      shareUrl: shareUrl.current?.(),
      onProgress: (p) => { if (!ctl.signal.aborted) setExportProgress(p); },
    }).then((result) => {
      if (ctl.signal.aborted) return;
      setLastExport(result);
    }).finally(() => {
      if (exportCtl.current === ctl) {
        exportCtl.current = null;
        setExporting(false);
      }
    });
  }, [memory, lastImport]);

  return {
    connected: !!memory,
    filter, setFilter, clearFilter,
    importing, progress, lastImport, problems, runImport, cancelImport,
    exporting, exportProgress, lastExport, runExport,
  };
}
