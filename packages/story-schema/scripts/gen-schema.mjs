// Generate schema/story.schema.json (JSON Schema draft 2020-12) from the Zod
// source of truth. Run `npm run gen:schema` (builds first, then emits).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Story } from '../dist/schema.js';

const out = fileURLToPath(new URL('../schema/story.schema.json', import.meta.url));
const json = zodToJsonSchema(Story, {
  name: 'CompanionAtlasStory',
  target: 'jsonSchema2020-12',
  $refStrategy: 'root',
});
writeFileSync(out, JSON.stringify(json, null, 2) + '\n');
console.log('Wrote', out);
