/**
 * Image / image-set / video  →  geolocated 3D asset pipeline.
 *
 * Three stages, each a job that runs in the GPU worker container
 * (docker/Dockerfile.worker) and reports progress back through the JobStore:
 *
 *   1. ingest()      — extract EXIF GPS + capture time from photos, sample
 *                      frames + GPMF/telemetry tracks from video (ffmpeg),
 *                      reverse-geocode, and emit MediaItem records.
 *   2. reconstruct() — Structure-from-Motion + dense reconstruction. Two
 *                      backends, selected per job:
 *                        • photogrammetry → COLMAP + OpenMVS, or
 *                          OpenDroneMap/NodeODM for georeferenced aerial sets.
 *                        • gaussian-splat → COLMAP poses + Nerfstudio/gsplat.
 *   3. tile()        — convert the result to streamable, HLOD 3D Tiles:
 *                        • meshes  → py3dtiles / 3d-tiles-tools (glTF → b3dm).
 *                        • splats  → SplatTransform / SOGS → KHR_gaussian_splatting
 *                          3D Tiles (Cesium 3DGS LOD, 2026).
 *
 * The functions below are typed orchestration stubs: they shell out to the
 * tools above (commands shown in comments) and return the shapes the rest of
 * the server expects. Wire them to a real queue + worker before production.
 */

import type { Derived3d, MediaItem } from './schema.js';
import type { Job, JobStore } from './store.js';

export type ReconstructBackend = 'photogrammetry' | 'gaussian-splat' | 'auto';

export interface IngestInput {
  /** Object-store URLs or `ci-memory://<id>` references. */
  sources: string[];
  /** Hints from the caller / agent. */
  hints?: { defaultLocation?: { lat: number; lon: number }; capturedAt?: string };
}

export interface IngestResult {
  media: MediaItem[];
}

export interface ReconstructInput {
  mediaIds: string[];
  backend?: ReconstructBackend;
}

/**
 * Stage 1 — extract geo + time metadata and normalize inputs into MediaItems.
 *
 * Real implementation:
 *   - images: `exiftool -json` → GPSLatitude/Longitude/DateTimeOriginal.
 *   - video:  `ffmpeg -i in.mp4 -vf fps=2 frame_%04d.jpg` for frames;
 *             `exiftool -ee -G3 -api largefilesupport=1` or `gopro2gpx`
 *             for GPMF GPS tracks; align frames to track by timestamp.
 *   - reverse-geocode via the Overture/Nominatim place layer.
 */
export async function ingest(input: IngestInput, _jobs?: JobStore): Promise<IngestResult> {
  // TODO: dispatch to worker; this stub echoes the inputs as bare MediaItems.
  const media: MediaItem[] = input.sources.map((uri, i) => ({
    id: `media_${Date.now()}_${i}`,
    kind: uri.match(/\.(mp4|mov|avi)$/i) ? 'video' : uri.endsWith('/') ? 'image-set' : 'image',
    uri,
    location: input.hints?.defaultLocation
      ? { lat: input.hints.defaultLocation.lat, lon: input.hints.defaultLocation.lon }
      : undefined,
    capturedAt: input.hints?.capturedAt
  }));
  return { media };
}

/**
 * Stage 2 + 3 — reconstruct media into a 3D asset and tile it for streaming.
 * Returns the Derived3d reference that gets attached to the MediaItem.
 *
 * Real implementation (photogrammetry):
 *   colmap automatic_reconstructor --image_path imgs --workspace_path ws
 *   OpenMVS: DensifyPointCloud / ReconstructMesh / TextureMesh
 *   py3dtiles convert mesh.glb → tileset.json
 *
 * Real implementation (gaussian splat):
 *   ns-process-data images --data imgs --output-dir ws   (Nerfstudio)
 *   ns-train splatfacto --data ws                         (or gsplat)
 *   splat-transform model.ply model.3dtiles               (KHR_gaussian_splatting)
 */
export async function reconstruct(input: ReconstructInput, jobs: JobStore): Promise<Job> {
  const job = await jobs.enqueue('reconstruct');
  // TODO: push to the worker queue. Worker calls back jobs.update(job.id, ...)
  // with progress and finally a Derived3d result. Here we only enqueue.
  await jobs.update(job.id, {
    state: 'queued',
    detail: `reconstruct ${input.mediaIds.length} item(s) via ${input.backend ?? 'auto'}`
  });
  return (await jobs.get(job.id))!;
}

/** Shape the worker reports back when reconstruction + tiling succeeds. */
export function derived3dFromBackend(backend: ReconstructBackend, tilesetUri: string, job: string): Derived3d {
  return {
    kind: backend === 'gaussian-splat' ? 'gaussian-splat' : '3d-tiles',
    uri: tilesetUri,
    job
  };
}
