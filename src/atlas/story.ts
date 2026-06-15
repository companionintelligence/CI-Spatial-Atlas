/**
 * Story loader — adapts a Companion Atlas 4D story document onto the current
 * three.js globe so it can be viewed today, before the Cesium viewer lands.
 *
 * Each `Scene` becomes a scrapbook `Pin` (located at its camera target or its
 * first geolocated media item), ordered by time to drive an auto-fly journey.
 * This is the bridge that lets the existing viewer render the new schema; the
 * Phase 2 Cesium viewer will consume the full `Story` (clock + 3D Tiles +
 * splats) natively. See REIMAGINE.md.
 *
 * Activated only via `?story=<url>` — default rendering is untouched.
 */

import type { Pin } from '../types';
import { isStory, sceneInstant, type MediaItem, type Scene, type Story } from './schema';

/** Fetch and validate a story document. Returns null on any failure. */
export async function fetchStory(url: string): Promise<Story | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.warn(`[atlas] story fetch failed: ${res.status} ${url}`);
      return null;
    }
    const json: unknown = await res.json();
    if (!isStory(json)) {
      console.warn('[atlas] fetched document is not a companion.atlas/story@1');
      return null;
    }
    return json;
  } catch (err) {
    console.warn('[atlas] story fetch error:', err);
    return null;
  }
}

function resolveSceneLocation(
  scene: Scene,
  mediaById: Map<string, MediaItem>
): { lat: number; lon: number; height: number } | null {
  if (scene.camera?.location) {
    const { lat, lon, height } = scene.camera.location;
    return { lat, lon, height: height ?? 0 };
  }
  for (const id of scene.mediaIds ?? []) {
    const loc = mediaById.get(id)?.location;
    if (loc) return { lat: loc.lat, lon: loc.lon, height: loc.height ?? 0 };
  }
  return null;
}

/** Convert a story's scenes into time-ordered scrapbook pins. */
export function storyToPins(story: Story): Pin[] {
  const mediaById = new Map(story.media.map((m) => [m.id, m]));

  const pins: Pin[] = [];
  for (const scene of [...story.scenes].sort((a, b) => sceneInstant(a) - sceneInstant(b))) {
    const loc = resolveSceneLocation(scene, mediaById);
    if (!loc) continue;

    const firstMedia = (scene.mediaIds ?? [])
      .map((id) => mediaById.get(id))
      .find((m): m is MediaItem => m !== undefined);

    const time = typeof scene.time === 'string' ? scene.time : scene.time?.start;

    pins.push({
      id: scene.id,
      label: scene.title,
      notes: scene.narrative ?? '',
      mediaUrl: firstMedia?.thumbnailUri ?? firstMedia?.uri ?? '',
      lat: loc.lat,
      lon: loc.lon,
      altitude: loc.height,
      createdAt: time ?? story.createdAt
    });
  }

  return pins;
}
