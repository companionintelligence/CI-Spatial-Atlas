/**
 * Atlas → Companion Memory: writing a story back as memory.
 *
 * The other half of `import.ts`, and the peer of the KML/GeoJSON *exporters*:
 * a `Story` — its scenes, curated narrative, media references and places —
 * written into CI-Server as events, such that re-importing reconstructs an
 * equivalent story. `saveStoryToMemory()` (client.ts) already wrote the story
 * document as one `atlas-story` event; this module makes the write a real
 * export by also placing the story's **authored media as located events** and
 * carrying its **place roster** along, and by being explicit about what the
 * mapping cannot carry.
 *
 * Three events shapes leave here, all idempotent on CI-Server's
 * (sourceType, sourceSystem, sourceId) triple — exporting twice updates, it
 * does not duplicate:
 *
 *   `atlas-story`  one per story. `metadata.story` is the whole canonical
 *                  document, which is what makes the round-trip lossless for
 *                  everything CI-Server has no column for (scenes, cameras,
 *                  layers, narrative).
 *   `atlas-media`  one per authored located entity. `metadata.item` is the
 *                  canonical `Item`, so a re-import restores the media URL and
 *                  place that `createEvent` itself has no fields for.
 *   (places)       carried inside the story event's `metadata.places` by
 *                  default; optionally *also* written as real Place rows, see
 *                  `createPlaces` — which is off by default and unverified.
 *
 * ## What is lossy, in this direction
 *
 * Stated here, in `MemoryExportResult.lossy`, and in the report — a silently
 * lossy round-trip is worse than a documented one:
 *
 * 1. **Media bytes are never uploaded.** An exported event *references* the
 *    URL the story held. When that URL is a CI-Server presigned path it expires
 *    (~1 h), so a story exported today and re-imported next week has live pins
 *    and dead images. Uploading bytes needs an object-store endpoint Atlas has
 *    not been given.
 * 2. **A story collapses to one anchor point.** `createEvent` takes a single
 *    `Point`; a journey's real extent (a track, a continent of pins) survives
 *    only inside `metadata.story`, so CI-Server's own map shows the story at
 *    its first located entity and nowhere else.
 * 3. **Geometry has no server-side type.** Tracks, polygons and camera paths
 *    are JSON in metadata, not PostGIS — nothing on the server can query them
 *    spatially.
 * 4. **Memory-sourced entities are not re-written by default** (`media:
 *    'authored'`). They already exist as the user's own memories; copying them
 *    under `sourceSystem: 'companion-atlas'` would double every pin on the next
 *    import. The consequence is that the exported event set is *not*
 *    self-contained: re-importing it into a **different** archive restores the
 *    story document but not the borrowed memories. Pass `media: 'all'` when
 *    that self-containment is what you want.
 * 5. **Visibility is renamed, not preserved.** `unlisted` becomes CI-Server's
 *    `household`; a re-import reads `household` back as `unlisted`. Distinct
 *    server-side sharing that Atlas has no word for is flattened.
 * 6. **Place rows are the server's, not ours.** By default Atlas does not
 *    create Places; the roster travels as metadata and is restored by the
 *    importer, but a place Atlas invented never becomes a first-class
 *    CI-Server Place that other Companion apps can see.
 */
import {
  SAVE_STORY_MUTATION,
  createEventInputFromStory,
  storyEntities,
  timelineBounds,
  type CreateEventInput,
  type Item,
  type MediaItem,
  type Place,
  type Story,
} from '@companion-atlas/story';
import { memoryGraphQL, type MemorySource } from './client.js';
import { isSchemaGap } from './import.js';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface MemoryExportOptions {
  /** Public link to the story, stored on the event for the household feed. */
  shareUrl?: string;
  /**
   * Which located entities get their own `atlas-media` event.
   * - `authored` (default) — only entities Atlas owns. Entities that came from
   *   Companion Memory in the first place are left alone; they are already
   *   there, and re-writing them doubles every pin on the next import.
   * - `all` — write everything, for a self-contained export into a *different*
   *   archive. Expect duplicates when importing back into the source archive.
   * - `none` — the story document only.
   */
  media?: 'authored' | 'all' | 'none';
  /** Carry a place roster in the story event's metadata (default true). */
  includePlaces?: boolean;
  /** The roster to carry — normally `importFromMemory().places`. When omitted,
   *  one is derived from the story's own `placeId`/`placeName` fields. */
  places?: Place[];
  /**
   * Also write real CI-Server Place rows (default **false**).
   *
   * `createPlace` is an *assumed* mutation: nothing in this repo has been
   * verified against a live CI-Server that exposes it, so it stays opt-in and
   * degrades to a warning rather than failing the export. Verify the mutation
   * name and input shape against a real server before turning it on.
   */
  createPlaces?: boolean;
  /** Cap on total writes (default 500) — an export is somebody's whole archive
   *  if they ask for `media: 'all'`, and a thousand serial mutations is a hang. */
  maxWrites?: number;
  signal?: AbortSignal;
  onProgress?: (p: MemoryExportProgress) => void;
}

export interface MemoryExportProgress {
  phase: 'places' | 'media' | 'story';
  written: number;
  total: number;
  done: boolean;
}

export interface MemoryExportResult {
  /** True only when the story event itself was written. Media/place failures
   *  are degradations (see `failed`), because the story document already holds
   *  everything needed to reconstruct them. */
  ok: boolean;
  storyEventId?: string;
  mediaEventIds: string[];
  placeIds: string[];
  /** Entities the mapping deliberately did not write, with the reason. */
  skipped: { id: string; reason: string }[];
  /** Entities the server refused. Reasons are scrubbed of credentials. */
  failed: { id: string; reason: string }[];
  /** Machine-readable list of what this particular export could not carry —
   *  render it next to the success message rather than claiming a clean save. */
  lossy: string[];
  warnings: string[];
  error?: string;
}

/** The event inputs an export would send. Pure — no network, so the mapping is
 *  unit-testable on its own and a caller can preview a write. */
export interface MemoryExportPlan {
  story: CreateEventInput;
  media: CreateEventInput[];
  places: Place[];
  skipped: { id: string; reason: string }[];
  lossy: string[];
}

// ---------------------------------------------------------------------------
// Mapping (pure)
// ---------------------------------------------------------------------------

/** Atlas visibility → CI-Server `sharingLevel`. Mirrors the mapping in
 *  `@companion-atlas/story`'s `createEventInputFromStory` (which keeps its copy
 *  private), so a story's media shares exactly as widely as its story. */
const SHARING: Record<string, CreateEventInput['sharingLevel']> = {
  private: 'private',
  unlisted: 'household',
  public: 'public',
};

/** An entity `mediaToEntities` derived from a reconstruction (`<id>#derived`).
 *  Its source `MediaItem` is already written in full, so writing it again would
 *  place a second pin on the same spot for the same memory. */
const isDerived = (id: string) => id.endsWith('#derived');

/** Was this entity already in Companion Memory before Atlas touched it? */
function isFromMemory(item: Item, media?: MediaItem): boolean {
  return item.source?.kind === 'ci-memory' || !!item.source?.memoryId || !!media?.sourceMemoryId;
}

function positionOf(item: Item): { lat: number; lon: number } | undefined {
  if ('position' in item && item.position) return item.position;
  // A track has no single position; anchor it at its first sample and let the
  // full path ride in metadata (lossy point 3).
  if (item.type === 'track' && item.path[0]) return { lat: item.path[0].lat, lon: item.path[0].lon };
  return undefined;
}

function timeOf(item: Item): string | undefined {
  const t = item.time;
  if (typeof t === 'string') return t;
  if (t) return t.at ?? t.start;
  if (item.type === 'track') return item.path[0]?.time;
  return undefined;
}

/**
 * Build every `createEvent` input an export would send, without sending any.
 *
 * Anything skipped is reported rather than dropped: an entity with no
 * coordinates or no time cannot become a CI-Server event (both columns are
 * required), and silently losing it is how an export comes back missing three
 * pins that nobody can account for.
 */
export function planExport(story: Story, opts: MemoryExportOptions = {}): MemoryExportPlan {
  const mode = opts.media ?? 'authored';
  const vis = story.access?.visibility ?? story.visibility ?? 'private';
  const sharingLevel = SHARING[vis] ?? 'private';
  const bounds = timelineBounds(story);
  const mediaById = new Map((story.media ?? []).map((m) => [m.id, m]));
  const places = opts.includePlaces === false ? [] : (opts.places ?? placesFromStory(story));

  const skipped: { id: string; reason: string }[] = [];
  const events: CreateEventInput[] = [];

  if (mode !== 'none') {
    for (const item of storyEntities(story)) {
      if (isDerived(item.id)) { skipped.push({ id: item.id, reason: 'derived from a media item already written' }); continue; }
      const source = mediaById.get(item.id);
      if (mode === 'authored' && isFromMemory(item, source)) {
        skipped.push({ id: item.id, reason: 'already a Companion Memory row (pass media:"all" to copy it)' });
        continue;
      }
      const position = positionOf(item);
      if (!position) { skipped.push({ id: item.id, reason: 'no coordinates — CI-Server events must be located' }); continue; }
      // `startTime` is NOT NULL server-side. Falling back to the story's own
      // start keeps an undated entity placeable instead of dropping it; it is a
      // real (documented) approximation, not a true capture time.
      const startTime = timeOf(item) ?? bounds.start;

      events.push({
        title: item.title ?? source?.caption ?? undefined,
        description: item.description ?? source?.description ?? undefined,
        eventType: 'atlas-media',
        startTime,
        endTime: typeof item.time === 'object' ? item.time?.end ?? item.time?.stop : undefined,
        locationName: item.placeName ?? source?.locationName ?? undefined,
        locationCoordinates: { type: 'Point', coordinates: [position.lon, position.lat] },
        sourceType: 'media',
        sourceSystem: 'companion-atlas',
        // Story-scoped so the same media in two stories stays two rows, and so
        // re-exporting the same story updates rather than duplicates.
        sourceId: `${story.id}:${item.id}`,
        metadata: {
          atlas: 'media',
          storyId: story.id,
          storyTitle: story.title,
          // The canonical entity, whole. CI-Server has no media columns on
          // `createEvent`, so this is the only thing that makes an exported
          // photo come back as a photo rather than an anonymous pin.
          item,
          ...(source ? { mediaItem: source } : {}),
          ...(item.placeId ? { placeId: item.placeId } : {}),
          ...(item.placeName ? { placeName: item.placeName } : {}),
          ...(source?.people?.length ? { people: source.people } : {}),
          ...(source?.exif ? { exif: source.exif } : {}),
        },
        sharingLevel,
      });
    }
  }

  const storyEvent = createEventInputFromStory(story, { shareUrl: opts.shareUrl });
  storyEvent.metadata = {
    ...storyEvent.metadata,
    atlas: 'story',
    // The roster travels with the story so a re-import restores named places
    // even against a server whose `places()` doesn't know them (lossy point 6).
    ...(places.length ? { places } : {}),
    mediaEventCount: events.length,
  };

  const lossy = [
    'Media bytes are not uploaded — exported events reference the existing URLs, and CI-Server presigned URLs expire (~1h).',
    'The story is anchored at one point; its full extent lives only in the story document.',
    'Tracks and camera paths are JSON metadata, not server-side geometry.',
    `Visibility "${vis}" is stored as CI-Server sharingLevel "${sharingLevel}".`,
  ];
  if (mode === 'authored' && skipped.some((s) => s.reason.startsWith('already a Companion Memory'))) {
    lossy.push('Entities that came from Companion Memory were not re-written; the exported set is not self-contained.');
  }
  if (opts.createPlaces !== true && places.length) {
    lossy.push('Places travel as story metadata; no CI-Server Place rows were created.');
  }

  return { story: storyEvent, media: events, places, skipped, lossy };
}

/**
 * The places a story knows about, from the `placeId`/`placeName` its entities
 * carry. The fallback when the caller has no live roster to pass — a story
 * loaded from a file has never seen `places()`, and exporting it should still
 * carry the names it does know rather than nothing.
 *
 * Coordinates are the mean of the entities at that place: unlike the import
 * side (where inventing a coordinate for a server row would overwrite the
 * server's own considered decision to have none), here there is no server row
 * to contradict — the alternative is a named place with no location at all.
 */
export function placesFromStory(story: Story): Place[] {
  const acc = new Map<string, { name?: string; lat: number; lon: number; n: number; visits: number }>();
  for (const item of storyEntities(story)) {
    const id = item.placeId ?? (item.placeName ? `name:${item.placeName}` : undefined);
    if (!id) continue;
    const cur = acc.get(id) ?? { lat: 0, lon: 0, n: 0, visits: 0 };
    cur.name ??= item.placeName;
    cur.visits += 1;
    const p = positionOf(item);
    if (p) { cur.lat += p.lat; cur.lon += p.lon; cur.n += 1; }
    acc.set(id, cur);
  }
  return [...acc.entries()].map(([id, v]) => ({
    id,
    name: v.name,
    latitude: v.n ? v.lat / v.n : undefined,
    longitude: v.n ? v.lon / v.n : undefined,
    visitStats: { visitCount: v.visits },
  }));
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

/** Same shape as `SAVE_STORY_MUTATION`; named separately because a media write
 *  is a different intent and may want different fields back later. */
const SAVE_EVENT_MUTATION = /* GraphQL */ `
  mutation AtlasSaveEvent($input: CreateEventInput!) {
    createEvent(input: $input) { id title startTime }
  }
`;

/**
 * ASSUMED, opt-in (see `MemoryExportOptions.createPlaces`). Not verified
 * against a live CI-Server: both the mutation name and the input fields are a
 * guess modelled on `PlaceType`. It fails soft — a schema gap turns into one
 * warning and the export continues — but do not build on it until someone has
 * run it against a real server.
 */
const CREATE_PLACE_MUTATION = /* GraphQL */ `
  mutation AtlasCreatePlace($input: CreatePlaceInput!) {
    createPlace(input: $input) { id name }
  }
`;

function scrub(e: unknown, src: MemorySource): string {
  const msg = e instanceof Error ? e.message : String(e);
  return src.token ? msg.split(src.token).join('<token>') : msg;
}

/**
 * Export a story into Companion Memory.
 *
 * Resolves — never rejects — so a save button can't take React down with it.
 * `ok` reflects the story event only; check `failed`/`warnings`/`lossy` to tell
 * the user what actually landed.
 *
 * ```ts
 * const r = await exportStoryToMemory(memory, story, {
 *   shareUrl: location.href,
 *   places,                       // from importFromMemory()
 *   onProgress: (p) => setSaving(`${p.phase} ${p.written}/${p.total}`),
 * });
 * if (!r.ok) toast(r.error!);
 * ```
 */
export async function exportStoryToMemory(
  src: MemorySource,
  story: Story,
  opts: MemoryExportOptions = {},
): Promise<MemoryExportResult> {
  const plan = planExport(story, opts);
  const maxWrites = Math.max(1, opts.maxWrites ?? 500);
  // `plan.lossy` is what the mapping knows before it talks to a server; what
  // the server then refuses (Place rows it can't create, rows it rejects) is
  // equally lossy and gets appended as it happens.
  const lossy = [...plan.lossy];
  const warnings: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const mediaEventIds: string[] = [];
  const placeIds: string[] = [];
  const report = (phase: MemoryExportProgress['phase'], written: number, total: number, done: boolean) => {
    try { opts.onProgress?.({ phase, written, total, done }); } catch { /* the caller's problem */ }
  };

  // --- Places (opt-in, unverified mutation) --------------------------------
  if (opts.createPlaces === true && plan.places.length) {
    report('places', 0, plan.places.length, false);
    for (const [i, place] of plan.places.entries()) {
      if (opts.signal?.aborted) break;
      try {
        const data = await memoryGraphQL<{ createPlace?: { id?: string } }>(
          src,
          CREATE_PLACE_MUTATION,
          {
            input: {
              name: place.name ?? place.id,
              placeKind: place.placeKind,
              latitude: place.latitude,
              longitude: place.longitude,
            },
          },
          { signal: opts.signal },
        );
        if (data?.createPlace?.id) placeIds.push(data.createPlace.id);
      } catch (e) {
        if (isSchemaGap(e)) {
          // The server has no such mutation. One warning, then stop trying —
          // 200 identical failures is not more informative than one.
          warnings.push('This Companion Memory has no `createPlace` mutation; places travel as story metadata only.');
          lossy.push('Places travel as story metadata; this server cannot create CI-Server Place rows.');
          break;
        }
        failed.push({ id: place.id, reason: scrub(e, src) });
      }
      report('places', i + 1, plan.places.length, false);
    }
    report('places', placeIds.length, plan.places.length, true);
  }

  // --- Authored media ------------------------------------------------------
  const mediaToWrite = plan.media.slice(0, Math.max(0, maxWrites - 1)); // -1: the story event
  if (mediaToWrite.length < plan.media.length) {
    warnings.push(`Wrote ${mediaToWrite.length} of ${plan.media.length} media events (maxWrites).`);
  }
  if (mediaToWrite.length) {
    report('media', 0, mediaToWrite.length, false);
    for (const [i, input] of mediaToWrite.entries()) {
      if (opts.signal?.aborted) break;
      try {
        const data = await memoryGraphQL<{ createEvent?: { id?: string } }>(
          src, SAVE_EVENT_MUTATION, { input }, { signal: opts.signal },
        );
        if (data?.createEvent?.id) mediaEventIds.push(data.createEvent.id);
      } catch (e) {
        // One bad row must not lose the story. The whole document goes out with
        // the story event below regardless, so this is a degradation, not a
        // failure — but it IS reported, because a half-written export that
        // claims success is how a person loses a photo without being told.
        failed.push({ id: String(input.sourceId), reason: scrub(e, src) });
      }
      report('media', i + 1, mediaToWrite.length, false);
    }
    report('media', mediaEventIds.length, mediaToWrite.length, true);
  }

  // --- The story itself, last ---------------------------------------------
  // Deliberately after its media: the story event is what a household feed
  // surfaces, so it should not appear before the pins it refers to exist.
  if (opts.signal?.aborted) {
    return { ok: false, mediaEventIds, placeIds, skipped: plan.skipped, failed, lossy, warnings, error: 'Export cancelled.' };
  }
  report('story', 0, 1, false);
  try {
    const data = await memoryGraphQL<{ createEvent?: { id?: string; title?: string } }>(
      src, SAVE_STORY_MUTATION, { input: plan.story }, { signal: opts.signal },
    );
    const id = data?.createEvent?.id;
    if (!id) throw new Error('Companion Memory did not confirm the save.');
    report('story', 1, 1, true);
    return { ok: true, storyEventId: id, mediaEventIds, placeIds, skipped: plan.skipped, failed, lossy, warnings };
  } catch (e) {
    report('story', 0, 1, true);
    return {
      ok: false,
      mediaEventIds,
      placeIds,
      skipped: plan.skipped,
      failed,
      lossy,
      warnings,
      error: scrub(e, src),
    };
  }
}
