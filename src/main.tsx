import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { tracks as defaultTracks, TimedPointTrack, TimedPointSample } from './data/points';
import { CesiumViewer } from './components/CesiumViewer';
import { TrackEditor } from './ui/TrackEditor';
import { geoJSONToTracks, tracksToGeoJSON } from './lib/geojson';
import { useState, useEffect } from 'react';

const ionToken = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN as string | undefined;

function App() {
  const [tracks, setTracks] = useState<TimedPointTrack[]>(defaultTracks);

  // Load from localStorage or default
  useEffect(() => {
    const saved = localStorage.getItem('tracksGeoJSON');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const loadedTracks = geoJSONToTracks(parsed);
        console.log('Loaded tracks from localStorage:', loadedTracks.length);
        setTracks(loadedTracks);
        return;
      } catch (e) {
        console.warn('Failed to load tracks from localStorage:', e);
      }
    }
    console.log('Using default tracks:', defaultTracks.length);
    setTracks(defaultTracks);
  }, []);

  // Persist
  useEffect(() => {
    if (tracks.length > 0) {
      try {
        const fc = tracksToGeoJSON(tracks);
        localStorage.setItem('tracksGeoJSON', JSON.stringify(fc));
        console.log('Saved tracks to localStorage:', tracks.length);
      } catch (e) {
        console.warn('Failed to save tracks to localStorage:', e);
      }
    }
  }, [tracks]);

  const handleImport = (fc: any) => {
    try {
      const t = geoJSONToTracks(fc);
      setTracks(t);
    } catch (e) {
      alert('Invalid GeoJSON: ' + (e as Error).message);
    }
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div style={{ width: 340, background: '#111827', color: '#fff', padding: '0.5rem', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Tracks</h3>
        <TrackEditor tracks={tracks} setTracks={setTracks} onImport={handleImport} />
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <CesiumViewer tracks={tracks} ionToken={ionToken} />
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<App />);
}
