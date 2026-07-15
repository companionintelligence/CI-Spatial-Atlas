import { describe, it, expect } from 'vitest';
import { Story, validateStory } from '../src/index.js';
import atlas from './fixtures/atlas-story.json';

describe('canonical Zod schema', () => {
  it('accepts a valid legacy Atlas story directly (it is already canonical)', () => {
    expect(Story.safeParse(atlas).success).toBe(true);
    expect(validateStory(atlas).valid).toBe(true);
  });

  it('reports readable errors for an empty object', () => {
    const r = validateStory({});
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
