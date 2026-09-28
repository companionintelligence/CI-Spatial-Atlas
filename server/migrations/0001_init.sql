-- Companion Atlas — D1 schema (Cloudflare Worker deployment).
--
-- Mirrors InMemoryStore (server/src/store.ts) as durable storage: each row
-- holds the whole Story/Job document as JSON (`doc`), the same shape the
-- Fastify server keeps in a Map. Nothing here queries into nested fields —
-- every filter (ownership, visibility) runs in application code exactly as
-- it does today — so a document store is the honest schema rather than a
-- premature relational model of a `Story` that is still actively changing
-- shape. `updated_at` is denormalized only so `listStories` can `ORDER BY`
-- without deserializing every row first.

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stories_updated_at ON stories (updated_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  story_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_story_id ON jobs (story_id);
