/**
 * Import and export panel — the surface that stops Atlas being a closed island.
 *
 * Import lands in the canonical `Story` model (see `importFile.ts`), so a
 * dropped KML is immediately exportable, collectable and visible on the WebXR
 * globe, not a Cesium-only overlay.
 *
 * Companion Memory is the *other* thing that goes in and out of here, and it is
 * a peer of files rather than a special case: the same panel, the same two
 * directions. Its sections live in `MemorySections.tsx` because they carry a
 * network's worth of state (progress, warnings, a lossiness report) that has
 * nothing to do with reading a dropped file.
 */
import { useCallback, useRef, useState } from 'react';
import type { Story } from '@companion-atlas/story';
import { INTEROP_ACCEPT } from './detectFormat.js';
import { importFiles, type ImportedFile } from './importFile.js';
import { downloadKml, downloadStoryJson } from './exportFile.js';
import { summarise } from './useImported.js';
import type { MemorySource } from '../memory/client.js';
import type { MemoryImport } from '../memory/import.js';
import { ShareIcon } from '../ui/icons.js';
import { MemoryExportSection, MemoryImportSection } from './MemorySections.js';
import { MediaUploadSection } from './MediaUploadSection.js';
import { atlasApiFromEnv } from '../upload/index.js';
import { useMemoryTransfer } from './useMemoryTransfer.js';
import './interop.css';

/** The Atlas API to upload to, or null when this build has none. Read once at
 *  module scope: `import.meta.env` is frozen at build time, so re-reading it
 *  per render would only hand `useMediaUpload` a new object every time. The
 *  cast is the same one `AtlasApp` uses — this workspace's `tsconfig` does not
 *  pull in `vite/client`. */
const ATLAS_API = atlasApiFromEnv(
  (import.meta as unknown as { env: Record<string, string | undefined> }).env,
);

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
  /** The connected CI-Server, or null. Null disables the two Memory sections
   *  rather than hiding the import one — "you could do this if you connected"
   *  is information; a missing section is not. */
  memory: MemorySource | null;
  /**
   * A completed Companion Memory import. **Required**, because the whole point
   * of this panel is that it does something: a panel that runs a multi-minute
   * import and drops the result on the floor is the bug being fixed here.
   *
   * The result is a *replacement*, not a merge — do not route it through
   * `onImported`/`withImported`. Those add to `story.items`, and `deriveModel`
   * builds its memory list from `story.scenes` whenever there are any, so items
   * merged into a story that has scenes never become memories at all. The
   * imported story has no scenes by design (`memoryToStory`), which is exactly
   * what makes `deriveModel`'s entity fallback project every row.
   */
  onMemoryImported: (result: MemoryImport) => void;
  /** Link to store on an exported story event. Already scrubbed of `?memory=`
   *  and `?token=` — a share URL is a public artifact. */
  shareUrl?: () => string | undefined;
  /** Where an uploaded photo or video gets pinned — read at the moment the file
   *  is chosen, so it is the view the user is actually looking at. Media with no
   *  position is not renderable and not expressible in KML, so the upload
   *  section reports that rather than inventing coordinates. */
  uploadPosition?: () => { lat: number; lon: number } | null;
  /**
   * Open the share panel. Omitted when sharing is off for this session, which
   * is what keeps the button from opening a panel that will not render — the
   * two are separate chrome decisions and only the caller knows both.
   */
  onShare?: () => void;
}

export function InteropPanel({
  open, onClose, story, files, onImported, onRemoveFile, onClearImported, onFrameImported,
  memory, onMemoryImported, shareUrl, uploadPosition, onShare,
}: InteropPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Above the `!open` early return: a closed panel must still be allowed to
  // hold a running import, or closing the drawer would cancel one mid-page.
  const transfer = useMemoryTransfer(memory, { onImported: onMemoryImported, shareUrl });

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

  // An upload arrives as one already-parsed file, so it joins the same list a
  // dropped KML does — listed, removable, and merged into the story by the same
  // code. Framing on success for the same reason an import does: a pin that
  // lands off-screen looks like nothing happened.
  const took = useCallback(
    (file: ImportedFile) => {
      onImported([file]);
      if (file.items.length) onFrameImported?.();
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

      {onShare && (
        // First, because it is the exit most people want and the only one that
        // costs nothing: no file, no account, no server. The three below all
        // produce something you then have to put somewhere.
        <section className="io-section">
          <h3>Share this view</h3>
          {/* The embed half is promised only when it can be delivered. A
              memory-backed view cannot be embedded — the credentials are
              stripped on the way out, so a reader would get the bundled sample
              — and `shareLink` refuses before it even parses the URL. Saying
              "or an <iframe>" here regardless would have made that promise in
              exactly the state this panel is most used in, and the control it
              replaced ("Copy link to this view") never did. */}
          <p className="io-hint">
            {memory
              ? 'A link that reopens the globe at this camera and this moment. Your Companion Memory address and token are never included — which is also why a private archive cannot be embedded in a page.'
              : (
                <>
                  A link that reopens the globe at this camera and this moment, or an{' '}
                  <code>&lt;iframe&gt;</code> to paste into a page.
                </>
              )}
          </p>
          <div className="io-actions">
            <button className="atlas-btn primary" onClick={onShare}>
              <ShareIcon />{memory ? 'Copy a link to this view' : 'Copy a link or embed code'}
            </button>
          </div>
        </section>
      )}

      <section className="io-section">
        <h3>Bring data in</h3>
        <p className="io-hint">
          Drop a file anywhere on the globe, or choose one. KML, GeoJSON and Atlas
          story files. Everything imported becomes part of the story, so it can be
          exported again, collected, and seen in a headset.
        </p>
        {/* The button below is the control: it opens this picker. The input is
            only the mechanism, so it is kept out of the tab order and the
            accessibility tree. Left in, it was a second tab stop, with no name
            and (here) a focus ring drawn on the button instead of on itself. */}
        <input
          ref={input}
          type="file"
          className="io-file"
          tabIndex={-1}
          aria-hidden="true"
          accept={INTEROP_ACCEPT}
          multiple
          onChange={(e) => void take(e.target.files)}
        />
        <button className="atlas-btn primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Reading…' : 'Choose files'}
        </button>
      </section>

      <MediaUploadSection api={ATLAS_API} onUploaded={took} position={uploadPosition} />

      <MemoryImportSection transfer={transfer} />

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

      <MemoryExportSection transfer={transfer} story={story} />
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
