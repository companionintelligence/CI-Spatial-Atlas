import { memoryToStory } from '@companion-atlas/story';
import { deriveModel } from './viewer-react/src/model/atlasModel.js';

// Exactly what CI-Server returns when zero located photo/video events match.
const emptyResult = { search: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, edges: [] } };

let story: any = null, err: any = null;
try {
  story = memoryToStory(emptyResult, { origin: 'http://localhost:3030', title: 'Companion Memory' });
} catch (e) { err = e; }

console.log('memoryToStory threw:', !!err, err?.message ?? '');
console.log('story:', JSON.stringify(story));

const model = deriveModel(story);
console.log('model.memories.length =', model.memories.length);
console.log('model.stats =', JSON.stringify(model.stats));
console.log('model.timeline =', JSON.stringify(model.timeline));
console.log('model.focused =', model.focused);

// AtlasApp.tsx:360 guard
const error = null;
console.log('guard `error || !model || !story` fires?', !!(error || !model || !story));

// non-zero totalCount but zero located rows (rows exist, none located)
const unlocated = {
  search: {
    totalCount: 42,
    edges: [
      { node: { __typename: 'EventType', id: 'e1', title: 'Kitchen', startTime: '2026-01-01T00:00:00Z', mediaContentType: 'image/jpeg', previewUrl: '/p.jpg', locationCoordinates: null } },
    ],
  },
};
const s2 = memoryToStory(unlocated, { origin: 'http://localhost:3030' });
console.log('unlocated -> media count:', s2.media?.length, 'memories:', deriveModel(s2).memories.length);
