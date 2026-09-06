/**
 * Import and export panel — the surface that stops Atlas being a closed island.
 *
 * Import lands in the canonical `Story` model (see `importFile.ts`), so a
 * dropped KML is immediately exportable, collectable and visible on the WebXR
 * globe, not a Cesium-only overlay.
 */
import { useCallback, useRef, useState } from 'react';
import type { Story } from '@companion-atlas/story';
import { INTEROP_ACCEPT } from './detectFormat.js';
import { importFiles, type ImportedFile } from './importFile.js';
import { downloadKml, downloadStoryJson } from './exportFile.js';
import { summarise } from './useImported.js';
import './interop.css';

export interface InteropPanelProps {
  open: boolean;
  onClose: () => void;
  /** The story as currently rendered, including anything already imported. */
  story: Story | null;
  files: ImportedFile[];
  onImported: (files: ImportedFile[]) => void;
  onRemoveFile: (fileName: string) => void;
  onClearImported: () => void;
  /** Fly the globe to everything that just arrived. */
  onFrameImported?: () => void;
}

export function InteropPanel({
  open, onClose, story, files, onImported, onRemoveFile, onClearImported, onFrameImported,
}: InteropPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const take = useCallback(
    async (list: FileList | File[] | null) => {
      const picked = Array.from(list ?? []);
      if (!picked.length) return;
      setBusy(true);
      try {
        const result = await importFiles(picked);
        onImported(result.files);
        if (result.items.length) onFrameImported?.();
      } finally {
        setBusy(false);
        // Clear the input, or picking the same file twice in a row is a no-op
        // because `change` never fires for an unchanged value.
        if (input.current) input.current.value = '';
      }
    },
    [onImported, onFrameImported],
  );

  if (!open) return null;

  const imported = files.filter((f) => !f.error);
  const failed = files.filter((f) => f.error);

  return (
    <aside className="atlas-interop" aria-label="Import and export">
      <header className="io-head">
        <h2>Import &amp; export</h2>
        <button className="io-close" aria-label="Close import and export" onClick={onClose}>✕</button>
      </header>

      <section className="io-section">
        <h3>Bring data in</h3>
        <p className="io-hint">
          Drop a file anywhere on the globe, or choose one. KML, GeoJSON and Atlas
          story files. Everything imported becomes part of the story, so it can be
          exported again, collected, and seen in a headset.
        </p>
        <input
          ref={input}
          type="file"
          className="io-file"
          accept={INTEROP_ACCEPT}
          multiple
          onChange={(e) => void take(e.target.files)}
        />
        <button className="atlas-btn primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Reading…' : 'Choose files'}
        </button>
      </section>

      {files.length > 0 && (
        <section className="io-section">
          <div className="io-section-head">
            <h3>Imported</h3>
            <button className="io-link" onClick={onClearImported}>Remove all</button>
          </div>
          <p className="io-summary">{summarise(files)}</p>
          <ul className="io-list">
            {files.map((f) => (
              <li key={f.fileName} className={f.error ? 'io-item bad' : 'io-item'}>
                <div className="io-item-main">
                  <span className="io-name" title={f.fileName}>{f.fileName}</span>
                  <span className="io-meta">
                    {f.error ? f.error : `${f.items.length} ${f.items.length === 1 ? 'feature' : 'features'} · ${f.format.toUpperCase()}`}
                  </span>
                </div>
                <button
                  className="io-remove"
                  aria-label={`Remove ${f.fileName}`}
                  onClick={() => onRemoveFile(f.fileName)}
                >✕</button>
              </li>
            ))}
          </ul>
          {imported.length > 0 && failed.length > 0 && (
            <p className="io-hint">The files that worked are already on the globe.</p>
          )}
        </section>
      )}

      <section className="io-section">
        <h3>Take data out</h3>
        <p className="io-hint">
          KML opens in Google Earth, QGIS and most GIS tools. Times travel with it —
          a <code>gx:Track</code> keeps a journey&rsquo;s per-point timestamps.
        </p>
        <div className="io-actions">
          <button className="atlas-btn" disabled={!story} onClick={() => story && downloadKml(story)}>
            Export KML
          </button>
          <button className="atlas-btn" disabled={!story} onClick={() => story && downloadStoryJson(story)}>
            Export story JSON
          </button>
        </div>
        <p className="io-note">
          Scenes, cameras and narration are not represented in KML and will not survive
          the round trip. Export story JSON to keep them.
        </p>
      </section>
    </aside>
  );
}

/** Full-window overlay shown while a file is being dragged in. */
export function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="atlas-dropzone" role="presentation">
      <div className="dz-card">
        <strong>Drop to import</strong>
        <span>KML, GeoJSON or an Atlas story</span>
      </div>
    </div>
  );
}
