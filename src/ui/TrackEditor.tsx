import { useRef } from 'react';
import { TimedPointTrack, TimedPointSample } from '../data/points';
import { tracksToGeoJSON } from '../lib/geojson';

interface Props {
  tracks: TimedPointTrack[];
  setTracks: (t: TimedPointTrack[]) => void;
  onImport: (fc: any) => void;
}

export function TrackEditor({ tracks, setTracks, onImport }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addTrack = () => {
    const now = new Date();
    const iso = now.toISOString();
    setTracks([
      ...tracks,
      {
        id: 'track-' + Math.random().toString(36).slice(2, 7),
        color: randomColor(),
        samples: [
          { time: iso, lon: 0, lat: 0, height: 0 },
          { time: new Date(now.getTime() + 60_000).toISOString(), lon: 0.01, lat: 0.01, height: 0 }
        ]
      }
    ]);
  };

  const updateTrack = (id: string, updater: (t: TimedPointTrack) => TimedPointTrack) => {
    setTracks(tracks.map(t => (t.id === id ? updater(t) : t)));
  };

  const removeTrack = (id: string) => setTracks(tracks.filter(t => t.id !== id));

  const addSample = (track: TimedPointTrack) => {
    const last = track.samples[track.samples.length - 1];
    const nextTime = new Date(new Date(last.time).getTime() + 60_000).toISOString();
    updateTrack(track.id, t => ({
      ...t,
      samples: [...t.samples, { time: nextTime, lon: last.lon, lat: last.lat, height: last.height }]
    }));
  };

  const updateSample = (track: TimedPointTrack, idx: number, patch: Partial<TimedPointSample>) => {
    updateTrack(track.id, t => {
      const samples = t.samples.slice();
      samples[idx] = { ...samples[idx], ...patch };
      // sort by time
      samples.sort((a, b) => a.time.localeCompare(b.time));
      return { ...t, samples };
    });
  };

  const deleteSample = (track: TimedPointTrack, idx: number) => {
    if (track.samples.length <= 2) return; // keep at least two for path
    updateTrack(track.id, t => ({ ...t, samples: t.samples.filter((_, i) => i !== idx) }));
  };

  const exportJSON = () => {
    const fc = tracksToGeoJSON(tracks);
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tracks.geojson';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImportClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(t => {
      try { onImport(JSON.parse(t)); } catch (err) { alert('Failed to parse JSON'); }
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <button onClick={addTrack}>Add Track</button>
        <button onClick={exportJSON}>Export</button>
        <button onClick={handleImportClick}>Import</button>
        <input ref={fileInputRef} type="file" accept="application/geo+json,application/json,.geojson" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>
      {tracks.map(track => (
        <details key={track.id} open style={{ marginBottom: '0.5rem', border: '1px solid #334155', borderRadius: 4, padding: '0.4rem' }}>
          <summary style={{ cursor: 'pointer' }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, background: track.color, border: '1px solid #000', marginRight: 6 }} />
            {track.id}
          </summary>
          <div style={{ marginTop: '0.3rem' }}>
            <label style={{ display: 'block', fontSize: 12 }}>ID
              <input value={track.id} onChange={e => updateTrack(track.id, t => ({ ...t, id: e.target.value }))} style={{ width: '100%' }} />
            </label>
            <label style={{ display: 'block', fontSize: 12 }}>Color
              <input type="color" value={track.color || '#ffffff'} onChange={e => updateTrack(track.id, t => ({ ...t, color: e.target.value }))} />
            </label>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 4 }}>
              <thead>
                <tr><th>Time (ISO)</th><th>Lon</th><th>Lat</th><th>H</th><th></th></tr>
              </thead>
              <tbody>
                {track.samples.map((s, i) => (
                  <tr key={i}>
                    <td><input style={{ width: '100%' }} value={s.time} onChange={e => updateSample(track, i, { time: e.target.value })} /></td>
                    <td><input style={{ width: 60 }} value={s.lon} type="number" onChange={e => updateSample(track, i, { lon: parseFloat(e.target.value) })} /></td>
                    <td><input style={{ width: 60 }} value={s.lat} type="number" onChange={e => updateSample(track, i, { lat: parseFloat(e.target.value) })} /></td>
                    <td><input style={{ width: 50 }} value={s.height ?? 0} type="number" onChange={e => updateSample(track, i, { height: parseFloat(e.target.value) })} /></td>
                    <td><button onClick={() => deleteSample(track, i)} disabled={track.samples.length <= 2}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button onClick={() => addSample(track)}>Add Sample</button>
              <button onClick={() => removeTrack(track.id)} style={{ marginLeft: 'auto' }}>Delete Track</button>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

function randomColor() {
  return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}
