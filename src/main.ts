import * as Cesium from 'cesium';
import { tracks, buildSampledPosition } from './data/points';

// Pull token from Vite env
const ionToken = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN as string | undefined;
if (!ionToken) {
  console.warn('Missing VITE_CESIUM_ION_ACCESS_TOKEN in .env');
}
Cesium.Ion.defaultAccessToken = ionToken || '';

const loadingEl = document.getElementById('loadingOverlay');

// Configure clock to span our sample timeframe
const startISO = tracks[0].samples[0].time;
const stopISO = tracks[0].samples[tracks[0].samples.length - 1].time;
const start = Cesium.JulianDate.fromIso8601(startISO);
const stop = Cesium.JulianDate.fromIso8601(stopISO);

const viewer = new Cesium.Viewer('cesiumContainer', {
  shouldAnimate: true,
  timeline: true,
  animation: true,
  baseLayerPicker: true,
  sceneModePicker: true,
  navigationHelpButton: false,
  geocoder: false
});

viewer.clock.startTime = start.clone();
viewer.clock.stopTime = stop.clone();
viewer.clock.currentTime = start.clone();
viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
viewer.clock.multiplier = 30; // speed up playback

async function loadTileset() {
  try {
    const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(3667783);
    viewer.scene.primitives.add(tileset);
    await tileset.readyPromise;
    viewer.zoomTo(tileset);
  } catch (e) {
    console.error('Error loading tileset', e);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function addTracks() {
  for (const track of tracks) {
    const posProp = buildSampledPosition(track.samples);
    viewer.entities.add({
      id: track.id,
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start, stop })
      ]),
      position: posProp,
      point: {
        pixelSize: 10,
        color: track.color || Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1
      },
      label: {
        text: track.id,
        font: '12px sans-serif',
        fillColor: track.color || Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromAlpha(Cesium.Color.BLACK, 0.4),
        pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      path: {
        leadTime: 0,
        trailTime: 60 * 5,
        width: 2,
        material: track.color || Cesium.Color.WHITE
      }
    });
  }
}

addTracks();
loadTileset();

// Expose for console debugging
// @ts-expect-error
window.viewer = viewer;
