import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { TimedPointTrack, buildSampledPosition } from '../data/points';

export interface CesiumViewerProps {
  tracks: TimedPointTrack[];
  ionToken?: string;
}

export const CesiumViewer = ({ tracks, ionToken }: CesiumViewerProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  // Initialize viewer once
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;
    if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

    // Compute global start/stop across all tracks
    const allTimes = tracks.flatMap(t => [t.samples[0].time, t.samples[t.samples.length - 1].time]);
    const start = Cesium.JulianDate.fromIso8601(allTimes.sort()[0]);
    const stop = Cesium.JulianDate.fromIso8601(allTimes.sort().slice(-1)[0]);

  const viewer = new Cesium.Viewer(containerRef.current, {
      shouldAnimate: true,
      timeline: true,
      animation: true,
      baseLayerPicker: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      geocoder: false
    });
    viewerRef.current = viewer;
    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    viewer.clock.multiplier = 30;

    (async () => {
      try {
        const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(3667783);
        viewer.scene.primitives.add(tileset);
        if ('readyEvent' in tileset && (tileset as any).readyEvent?.addEventListener) {
          (tileset as any).readyEvent.addEventListener(() => viewer.zoomTo(tileset));
        } else {
          // Fallback: attempt immediate zoom (may adjust later once bounding sphere computed)
          viewer.zoomTo(tileset).catch(()=>{});
        }
      } catch (e) {
        console.error('Error loading tileset', e);
      }
    })();

    return () => {
      viewer.destroy();
    };
  }, [ionToken]);

  // Rebuild track entities when tracks change
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    // remove previous track entities
    viewer.entities.removeAll();
    for (const track of tracks) {
      const start = Cesium.JulianDate.fromIso8601(track.samples[0].time);
      const stop = Cesium.JulianDate.fromIso8601(track.samples[track.samples.length - 1].time);
      const posProp = buildSampledPosition(track.samples);
      const color = (track.color ? Cesium.Color.fromCssColorString(track.color) : Cesium.Color.YELLOW);
      viewer.entities.add({
        id: track.id,
        availability: new Cesium.TimeIntervalCollection([
          new Cesium.TimeInterval({ start, stop })
        ]),
        position: posProp,
        point: {
          pixelSize: 10,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1
        },
        label: {
          text: track.id,
          font: '12px sans-serif',
          fillColor: color,
          showBackground: true,
          backgroundColor: Cesium.Color.fromAlpha(Cesium.Color.BLACK, 0.4),
          pixelOffset: new Cesium.Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        path: {
          leadTime: 0,
            trailTime: 60 * 5,
          width: 2,
          material: color
        }
      });
    }
    // adjust clock range to union
    const times = tracks.flatMap(t => [t.samples[0].time, t.samples[t.samples.length - 1].time]).sort();
    if (times.length >= 2) {
      const viewer = viewerRef.current;
      if (viewer) {
        viewer.clock.startTime = Cesium.JulianDate.fromIso8601(times[0]);
        viewer.clock.stopTime = Cesium.JulianDate.fromIso8601(times[times.length - 1]);
      }
    }
  }, [tracks]);

  return <div ref={containerRef} id="cesiumViewer" style={{ width: '100%', height: '100%' }} />;
};
