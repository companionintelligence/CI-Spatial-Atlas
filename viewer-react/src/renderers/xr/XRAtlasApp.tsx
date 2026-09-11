/**
 * App root for the immersive path.
 *
 * The Cesium shell (`AtlasApp`) is a desktop application — rails, drawers, a
 * scrubber, a command palette — and none of that reaches a headset, where there
 * is no DOM inside the session. Rather than bend that shell, the XR route loads
 * the same Story from the same place and hands it straight to the globe.
 *
 * Loading, failure and "connected but empty" are worth the same care here as in
 * the flat app: a blank sky in a headset is indistinguishable from a crash.
 */
import { useMemo } from 'react';
import { useStory } from '../../story/useStory.js';
import { deriveModel } from '../../model/atlasModel.js';
import { XRStoryScene } from '../XRStoryScene.js';
import { StoryLoadError } from '../../ui/StoryLoadError.js';

export function XRAtlasApp() {
  const { story, error, loading, source, memory } = useStory();
  const model = useMemo(() => (story ? deriveModel(story) : null), [story]);

  if (loading) {
    return (
      <div className="atlas-boot">
        <div className="msg">Loading Companion Atlas…</div>
      </div>
    );
  }

  if (error || !model || !story) {
    return <StoryLoadError error={error} memoryUrl={memory?.url} />;
  }

  if (source === 'memory' && model.memories.length === 0) {
    return (
      <div className="atlas-boot">
        <div className="msg">
          <strong>Connected to Companion Memory — no located memories yet.</strong>
          <span>
            The search matched nothing with coordinates. Memories need a location to appear on the globe;
            imports without GPS won’t show here.
          </span>
          <span className="dim">Connected to {memory?.url}</span>
        </div>
      </div>
    );
  }

  return <XRStoryScene story={story} memories={model.memories} />;
}
