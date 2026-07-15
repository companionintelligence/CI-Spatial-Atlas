/** Runtime validation of a canonical `Story` (Zod). For the server + viewer. */
import { Story } from './schema.js';
import type { Story as StoryT } from './schema.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateStory(doc: unknown): ValidationResult {
  const r = Story.safeParse(doc);
  if (r.success) return { valid: true, errors: [] };
  return { valid: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '/'}: ${i.message}`) };
}

/** Validate and narrow, or throw with a readable message. */
export function assertStory(doc: unknown): StoryT {
  const { valid, errors } = validateStory(doc);
  if (!valid) throw new Error(`Invalid story:\n  - ${errors.join('\n  - ')}`);
  return doc as StoryT;
}
