import { useEffect, useState } from 'react';
import { useStory } from './story/useStory.js';
import { rendererForDevice, type RendererKind } from './renderers/rendererForDevice.js';
import { CesiumStoryViewer } from './renderers/CesiumStoryViewer.js';
import { XRStoryScene } from './renderers/XRStoryScene.js';

/**
 * Root: load one Story, pick a renderer by device, hand the SAME Story to
 * whichever renderer runs. One data path (ADR-0001).
 */
export function AtlasApp() {
  const { story, error, loading } = useStory();
  const [renderer, setRenderer] = useState<RendererKind | null>(null);

  useEffect(() => {
    rendererForDevice().then(setRenderer);
  }, []);

  if (loading || !renderer) return <div className="atlas-loading">Loading Companion Atlas…</div>;
  if (error) return <div className="atlas-error">Could not load story: {error}</div>;
  if (!story) return <div className="atlas-empty">No story. Append ?story=&lt;url&gt; to view one.</div>;

  return renderer === 'xr' ? <XRStoryScene story={story} /> : <CesiumStoryViewer story={story} />;
}
