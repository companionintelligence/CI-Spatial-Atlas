import { TimedPointTrack, TimedPointSample } from '../data/points';

// GeoJSON FeatureCollection with one Feature per track using MultiPoint geometry
export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONTrackFeature[];
}

export interface GeoJSONTrackFeature {
  type: 'Feature';
  geometry: {
    type: 'MultiPoint';
    coordinates: number[][]; // [lon, lat, height]
  };
  properties: {
    id: string;
    times: string[]; // ISO timestamps
    color?: string;
    meta?: Record<string, any>;
  };
}

export function tracksToGeoJSON(tracks: TimedPointTrack[]): GeoJSONFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks.map(t => ({
      type: 'Feature',
      geometry: {
        type: 'MultiPoint',
        coordinates: t.samples.map(s => [s.lon, s.lat, s.height ?? 0])
      },
      properties: {
        id: t.id,
        times: t.samples.map(s => s.time),
        color: t.color,
        meta: t.meta
      }
    }))
  };
}

export function geoJSONToTracks(fc: any): TimedPointTrack[] {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('Not a FeatureCollection');
  }
  return fc.features.map((f: any) => {
    if (f.type !== 'Feature' || f.geometry?.type !== 'MultiPoint') {
      throw new Error('Unsupported feature geometry');
    }
    const coords = f.geometry.coordinates;
    const times = f.properties?.times;
    if (!Array.isArray(coords) || !Array.isArray(times) || coords.length !== times.length) {
      throw new Error('Coordinate/time length mismatch');
    }
    const samples: TimedPointSample[] = coords.map((c: any, i: number) => ({
      lon: c[0],
      lat: c[1],
      height: c[2] ?? 0,
      time: times[i]
    }));
    return {
      id: f.properties?.id ?? 'track-' + Math.random().toString(36).slice(2, 8),
      color: f.properties?.color,
      samples,
      meta: f.properties?.meta
    } as TimedPointTrack;
  });
}
