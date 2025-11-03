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
    
    console.log('Initializing Cesium viewer with token:', ionToken ? 'Present' : 'Missing');
    if (ionToken) {
      Cesium.Ion.defaultAccessToken = ionToken;
    } else {
      console.warn('No Cesium Ion token provided - some features may not work');
    }

    // Compute global start/stop across all tracks - use defaults if no tracks
    let start, stop;
    if (tracks.length > 0 && tracks.some(t => t.samples.length > 0)) {
      try {
        const allTimes = tracks.flatMap(t => t.samples.map(s => s.time)).filter(Boolean);
        if (allTimes.length > 0) {
          const sortedTimes = allTimes.sort();
          start = Cesium.JulianDate.fromIso8601(sortedTimes[0]);
          stop = Cesium.JulianDate.fromIso8601(sortedTimes[sortedTimes.length - 1]);
        } else {
          throw new Error('No valid times found');
        }
      } catch (e) {
        console.warn('Error parsing track times, using default range:', e);
        // Fall back to default time range
        start = Cesium.JulianDate.now();
        stop = Cesium.JulianDate.addMinutes(start, 5, new Cesium.JulianDate());
      }
    } else {
      // Default time range for empty tracks
      start = Cesium.JulianDate.now();
      stop = Cesium.JulianDate.addMinutes(start, 5, new Cesium.JulianDate());
    }

    console.log('Creating viewer with', tracks.length, 'tracks, time range:', 
      Cesium.JulianDate.toIso8601(start), 'to', Cesium.JulianDate.toIso8601(stop));
    
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
    
    if (tracks.length === 0) {
      console.log('No tracks to display');
      return;
    }
    
    try {
      for (const track of tracks) {
        if (!track.samples || track.samples.length === 0) {
          console.warn(`Track ${track.id} has no samples, skipping`);
          continue;
        }
        
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
      
      // adjust clock range to union - only if we have valid tracks
      const validTracks = tracks.filter(t => t.samples && t.samples.length > 0);
      if (validTracks.length > 0) {
        const allTimes = validTracks.flatMap(t => t.samples.map(s => s.time)).filter(Boolean).sort();
        if (allTimes.length >= 2) {
          viewer.clock.startTime = Cesium.JulianDate.fromIso8601(allTimes[0]);
          viewer.clock.stopTime = Cesium.JulianDate.fromIso8601(allTimes[allTimes.length - 1]);
          viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(allTimes[0]);
          console.log('Updated clock range:', allTimes[0], 'to', allTimes[allTimes.length - 1]);
        }
      }
    } catch (error) {
      console.error('Error updating track entities:', error);
    }
  }, [tracks]);

  return <div ref={containerRef} id="cesiumViewer" style={{ width: '100%', height: '100%' }} />;
};
