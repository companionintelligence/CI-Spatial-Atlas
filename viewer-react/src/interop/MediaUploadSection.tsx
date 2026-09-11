/**
 * "Add a photo or video" — the Import & export panel's media picker.
 *
 * This is the caller `src/upload/` was written for and did not have. The module
 * shipped finished, tested and reachable from nothing, and its own header said
 * so; the two reasons it gave for staying unwired are both *deployment* facts
 * (no `VITE_ATLAS_API`, no sign-in), not reasons for the control to be
 * unbuildable. A control that renders and explains why it cannot run is the
 * thing this codebase already does everywhere else — it is what
 * `GET /api/media/config` exists to answer — and it is strictly better than a
 * feature nobody can find.
 *
 * What an upload produces is an `Item`, not a bare URL: uploaded media has to
 * travel the same road as an imported placemark — into the story, out through
 * KML and story JSON, into the scene editor's media pool, onto the globe — and
 * anything that only became a `<img src>` would be invisible to every one of
 * those. It is handed back as a one-file `ImportedFile` for exactly that
 * reason: the panel already lists, frames, removes and merges those.
 */
import { useCallback, useRef, type ReactNode } from 'react';
import type { Item } from '@companion-atlas/story';
import {
  acceptAttribute,
  formatBytes,
  isUploadBusy,
  useMediaUpload,
  validateFile,
  type AtlasApiConfig,
  type UploadedMedia,
} from '../upload/index.js';
import type { ImportedFile } from './importFile.js';

export interface MediaUploadSectionProps {
  /** Null when no Atlas API is configured — the section says so and disables. */
  api: AtlasApiConfig | null;
  /** Where an uploaded file lands: the same list as a dropped KML. */
  onUploaded: (file: ImportedFile) => void;
  /**
   * Where to pin it — read at the moment the file is chosen, not at render.
   *
   * A getter, because the camera moves between renders and an upload belongs
   * where the globe was pointed when the user picked the file. Passing a value
   * is how this went wrong the first time: it was the *focused memory*, which
   * does not move with the camera and defaults to the last memory in the story
   * while the opening flight frames the first.
   */
  position?: () => { lat: number; lon: number } | null;
  /** Overrides the section's own heading and explanatory line — the Scene
   *  editor uses this to say plainly that the result becomes *this scene's*
   *  background, rather than repeating the panel's generic copy out of
   *  context. Both default to the original text, so every existing call site
   *  is unaffected. */
  heading?: string;
  hint?: ReactNode;
}

/**
 * Uploaded media becomes a photo/video `Item` at a position.
 *
 * A media item with no position is not renderable and not exportable — KML has
 * no way to say "a picture, nowhere" — so this refuses to invent one silently.
 * When the caller has no position to give, the file still uploads and is still
 * listed; it simply carries no coordinates, and the panel says as much.
 */
export function itemFromUpload(
  media: UploadedMedia,
  fileName: string,
  position: { lat: number; lon: number } | null | undefined,
): Item | null {
  if (!position) return null;
  return {
    id: `upload-${media.key.replace(/[^A-Za-z0-9._-]+/g, '-')}`,
    type: media.kind === 'video' ? 'video' : 'photo',
    title: fileName,
    position: { lat: position.lat, lon: position.lon },
    // `url` only. An earlier cut wrote `poster: mediaItem.thumbnailUri` for a
    // video, which was wrong twice over: `poster` is not a field of `Media` —
    // the schema spells it `posterUrl` — and the value was always `undefined`,
    // because nothing generates a still when a video is uploaded. Writing a key
    // no reader knows would have made an uploaded video *look* like it carried
    // a poster while `sceneMediaPool` went on counting it as having none.
    // Leaving it out is what lets the scene editor's picker say the true thing:
    // "no poster frame".
    media: { url: media.url },
  } as unknown as Item;
}

export function MediaUploadSection({
  api, onUploaded, position,
  heading = 'Add a photo or video',
  hint = (
    <>
      Uploaded to this Atlas server and pinned at the middle of the view, so it
      travels with the story — onto the globe, out through an export, and, for a
      photo, into the scene editor&rsquo;s backgrounds. An uploaded video has no
      still frame, so it can be shown on the globe but not chosen as a scene
      background.
    </>
  ),
}: MediaUploadSectionProps) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useMediaUpload(api);
  const busy = isUploadBusy(upload.state);

  const take = useCallback(
    async (list: FileList | File[] | null) => {
      const file = Array.from(list ?? [])[0];
      if (input.current) input.current.value = '';
      if (!file) return;

      // Refused before a byte is sent, with the reason the server would have
      // given. Uploading 200 MB to be told the limit is 32 is the failure this
      // pre-check exists to avoid.
      const refusal = validateFile(file, upload.capability);
      if (refusal) {
        onUploaded({ fileName: file.name, format: 'media', items: [], error: refusal.message });
        return;
      }

      const outcome = await upload.upload(file);
      if (!outcome.ok) {
        // An abort is the user's own decision, not an error to report back.
        if (outcome.failure.code === 'aborted') return;
        onUploaded({ fileName: file.name, format: 'media', items: [], error: outcome.failure.message });
        return;
      }

      const item = itemFromUpload(outcome.media, file.name, position?.());
      onUploaded({
        fileName: file.name,
        format: 'media',
        items: item ? [item] : [],
        ...(item
          ? {}
          : {
              error:
                'Uploaded, but not placed: there was nowhere on the globe to pin it. ' +
                'Fly to the place it belongs and upload it again.',
            }),
      });
    },
    [upload, onUploaded, position],
  );

  const state = upload.state;

  return (
    <section className="io-section">
      <h3>{heading}</h3>
      <p className="io-hint">{hint}</p>

      {!upload.available && upload.reason && (
        <p className="io-note" role="status">{upload.reason}</p>
      )}

      <input
        ref={input}
        type="file"
        className="io-file"
        accept={acceptAttribute(upload.capability)}
        onChange={(e) => void take(e.target.files)}
      />
      <div className="io-actions">
        <button
          className="atlas-btn primary"
          disabled={!upload.available || busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Uploading…' : 'Choose a file'}
        </button>
        {state.phase === 'uploading' && (
          <button className="atlas-btn" onClick={upload.cancel}>Cancel</button>
        )}
      </div>

      {state.phase === 'uploading' && (
        <p className="io-summary" role="status">
          {state.fileName} · {state.percent}%
          {state.total > 0 && ` of ${formatBytes(state.total)}`}
        </p>
      )}
      {state.phase === 'done' && (
        <p className="io-summary" role="status">
          {state.fileName} · {formatBytes(state.media.bytes)} uploaded.
        </p>
      )}
      {state.phase === 'failed' && (
        <p className="io-note" role="status">{state.failure.message}</p>
      )}

    </section>
  );
}
