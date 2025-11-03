# CI Map Testbed

React + Cesium web app to visualize and edit time-dynamic geospatial tracks (timeline) plus a 3D Tileset.

## Quick Start

1. Create an `.env` file with:

```bash
echo "VITE_CESIUM_ION_ACCESS_TOKEN=YOUR_TOKEN_HERE" > .env
```

1. Install dependencies:

```bash
npm install
```

1. Run the dev server:

```bash
npm run dev
```

Open the printed local URL. You should see the Cesium globe, timeline and a loading overlay that disappears when assets load.

## Building

```bash
npm run build
npm run preview
```

## Adding & Editing Time-Dynamic Tracks

Use the left-hand Track Editor panel in the running app to:

* Add / remove tracks
* Add / edit / delete samples (time + lon + lat + optional height)
* Change track color & id
* Import / export GeoJSON

Edits are persisted automatically to `localStorage` (`tracksGeoJSON`).

Example programmatic track snippet (in `src/data/points.ts` default seeds):

```ts
export const tracks: TimedPointTrack[] = [
  {
    id: 'vehicle-42',
    color: Cesium.Color.LIME,
    samples: [
      { time: '2025-11-02T18:00:00Z', lon: -122.4, lat: 37.77 },
      { time: '2025-11-02T18:02:00Z', lon: -122.398, lat: 37.771 },
      { time: '2025-11-02T18:04:00Z', lon: -122.397, lat: 37.772 }
    ]
  }
];
```

Rules:

* ISO timestamps should be ascending (editor re-sorts after changes).
* Provide lon/lat in WGS84 degrees, optional height meters.
* Color stored as CSS hex.
* Clock automatically spans earliest start -> latest stop across all tracks.

To load external JSON dynamically outside the editor, replace the static import with a fetch:

```ts
const response = await fetch('/data/tracks.json');
const tracks = await response.json();
```

## GeoJSON Schema

Exported file is a FeatureCollection where each Feature represents a track:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "MultiPoint", "coordinates": [[lon, lat, height], ...] },
      "properties": {
        "id": "alpha",
        "times": ["2025-11-02T18:00:00Z", "2025-11-02T18:01:00Z", "..."],
        "color": "#00ffcc",
        "meta": { }
      }
    }
  ]
}
```

The order of `coordinates` aligns 1:1 with `times`.

Conversion utilities live in `src/lib/geojson.ts` (`tracksToGeoJSON` / `geoJSONToTracks`).

## Environment Token

The prior variable `CESIUM_ION_ACCESS_TOKEN` has been renamed for Vite consumption to `VITE_CESIUM_ION_ACCESS_TOKEN`. Rotate tokens periodically. Do not commit real tokens to public repositories.

## Future Enhancements

* Validation UI for overlapping / duplicate timestamps
* Performance: dynamic import Cesium submodules to shrink bundle
* Drag timeline scrubber integration with custom playback controls
* Export as animated video or frame sequence
* Server sync (REST or WebSocket) for collaborative editing


