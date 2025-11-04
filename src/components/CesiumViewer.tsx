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
    if (!containerRef.current) {
      console.warn('Container ref not available');
      return;
    }
    
    if (viewerRef.current) {
      console.log('Viewer already exists');
      return;
    }

    // Wait for container to have dimensions
    const initializeViewer = () => {
      if (!containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      console.log('Container dimensions:', rect.width, 'x', rect.height);
      
      if (rect.width === 0 || rect.height === 0) {
        console.warn('Container has no dimensions, waiting...');
        setTimeout(initializeViewer, 100);
        return;
      }
      
      console.log('Initializing Cesium viewer with token:', ionToken ? 'Present' : 'Missing');
      
      // Check WebGL support
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        console.error('WebGL is not supported on this browser/device');
        containerRef.current.innerHTML = '<div style="padding: 20px; color: red;">WebGL is not supported on this browser/device. Cesium requires WebGL to render 3D graphics.</div>';
        return;
      }
      console.log('WebGL support confirmed');
      
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
      
      try {
        const viewer = new Cesium.Viewer(containerRef.current, {
          shouldAnimate: true,
          timeline: true,
          animation: true,
          baseLayerPicker: true,
          sceneModePicker: true,
          navigationHelpButton: false,
          geocoder: false,
          homeButton: true,
          fullscreenButton: false,
          vrButton: false,
          infoBox: false, // Disable InfoBox to avoid sandboxing issues
          terrainProvider: undefined, // Use default terrain
        });
        
        console.log('Cesium viewer created successfully');
        console.log('Viewer canvas dimensions:', viewer.canvas.width, 'x', viewer.canvas.height);
        viewerRef.current = viewer;
        
        viewer.clock.startTime = start.clone();
        viewer.clock.stopTime = stop.clone();
        viewer.clock.currentTime = start.clone();
        viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
        viewer.clock.multiplier = 30;

        // Set initial camera view to show San Francisco Bay Area (where sample tracks are)
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(-122.4, 37.8, 10000), // San Francisco area
          orientation: {
            heading: 0.0,
            pitch: -Cesium.Math.PI_OVER_FOUR, // Look down at 45 degree angle
            roll: 0.0
          }
        });
        
        console.log('Camera positioned and viewer ready');
        
        // Force a render to make sure everything is working
        setTimeout(() => {
          if (viewerRef.current) {
            viewerRef.current.scene.requestRender();
            console.log('Forced scene render');
          }
        }, 100);
        
      } catch (error) {
        console.error('Failed to create Cesium viewer:', error);
        if (containerRef.current) {
          containerRef.current.innerHTML = `<div style="padding: 20px; color: red;">Failed to initialize Cesium: ${error instanceof Error ? error.message : String(error)}</div>`;
        }
      }
    };

    // Start initialization after a small delay to ensure the component is fully mounted
    setTimeout(initializeViewer, 50);

    return () => {
      if (viewerRef.current) {
        console.log('Destroying Cesium viewer');
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
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
