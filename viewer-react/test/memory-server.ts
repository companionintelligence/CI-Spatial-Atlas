/**
 * A fake CI-Server Companion Memory, shared by the import and round-trip
 * suites. Not a test file (no `.test.` in the name) so vitest doesn't collect
 * it.
 *
 * It is a *server*, not a stubbed `fetch`, for the same reason
 * `memory-client.test.ts` is: the transport under test does real things to a
 * real Response — reads the body before the status, parses non-JSON, follows
 * cursors — and a hand-rolled fetch stub tends to model the client's
 * assumptions back at it rather than the server's actual behaviour. Nothing
 * here reaches the network: it listens on 127.0.0.1 on an ephemeral port.
 *
 * It reproduces the CI-Server behaviours that have actually bitten this repo:
 *   - `search()` clamps `first` to 100 server-side, silently.
 *   - GraphQL validation failures come back as HTTP **400 with a valid
 *     `{errors:[…]}` body**.
 *   - `createEvent` is idempotent on (sourceType, sourceSystem, sourceId).
 *   - An unknown field fails the *whole* query, which is what the import's
 *     `metadata` probe has to survive.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeEvent {
  id: string;
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  locationName?: string;
  locationCoordinates?: { type: 'Point'; coordinates: [number, number] } | null;
  participantEntityIds?: string[];
  mediaContentType?: string | null;
  previewUrl?: string | null;
  mediaUrl?: string | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  category?: string | null;
  durationMinutes?: number | null;
  sourceSystem?: string | null;
  timeSource?: string | null;
  location?: { id: string; name?: string; placeKind?: string } | null;
  metadata?: Record<string, unknown> | null;
  /** Server-side filter column; never part of the selection set. */
  eventType?: string;
}

export interface FakePlace {
  id: string;
  name?: string;
  description?: string | null;
  placeKind?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  parentId?: string | null;
  visitStats?: { visitCount?: number; firstVisitAt?: string | null; lastVisitAt?: string | null };
}

export type FakeMode = 'ok' | 'empty' | 'malformed' | 'stuck' | 'unauth' | 'echoauth';

export interface FakeMemoryServer {
  url: string;
  events: FakeEvent[];
  places: FakePlace[];
  /** Inputs `createEvent` received, in order — the export assertions read this. */
  created: { input: Record<string, unknown>; id: string }[];
  /** Every `search()` variables object the client sent, for filter assertions. */
  searches: Record<string, unknown>[];
  mode: FakeMode;
  /** When false, any query selecting `metadata` fails validation (older server). */
  supportsMetadata: boolean;
  /** When false, `places()` fails validation (a CI-Server predating Places). */
  supportsPlaces: boolean;
  /** When false, `createPlace` fails validation (i.e. every known server). */
  supportsCreatePlace: boolean;
  close: () => Promise<void>;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Apply the `search(input:{…})` filters CI-Server applies server-side. */
function matches(e: FakeEvent, v: Record<string, unknown>): boolean {
  const hasLocation = v.hasLocation;
  const located = !!e.locationCoordinates;
  if (hasLocation === true && !located) return false;
  if (hasLocation === false && located) return false;

  const types = v.eventTypes as string[] | null | undefined;
  if (Array.isArray(types) && types.length && !types.includes(e.eventType ?? 'event')) return false;

  const start = v.startTime as string | undefined;
  const end = v.endTime as string | undefined;
  if (start && (!e.startTime || e.startTime < start)) return false;
  if (end && (!e.startTime || e.startTime > end)) return false;

  const bbox = v.bbox as number[] | undefined;
  if (Array.isArray(bbox) && bbox.length === 4) {
    const c = e.locationCoordinates?.coordinates;
    if (!c) return false;
    const [lon, lat] = c;
    const [w, s, ee, n] = bbox as [number, number, number, number];
    if (lat < s || lat > n) return false;
    // West > east means the box crosses the antimeridian.
    if (w <= ee ? lon < w || lon > ee : lon < w && lon > ee) return false;
  }
  return true;
}

/** The `EventType` projection, minus anything the selection didn't ask for. */
function project(e: FakeEvent, withMetadata: boolean): unknown {
  const { eventType: _eventType, metadata, ...rest } = e;
  return {
    node: {
      __typename: 'EventType',
      ...rest,
      ...(withMetadata ? { metadata: metadata ?? null } : {}),
    },
    cursor: `c:${e.id}`,
  };
}

export async function startFakeMemory(init: Partial<FakeMemoryServer> = {}): Promise<FakeMemoryServer> {
  const state: FakeMemoryServer = {
    url: '',
    events: init.events ?? [],
    places: init.places ?? [],
    created: [],
    searches: [],
    mode: init.mode ?? 'ok',
    supportsMetadata: init.supportsMetadata ?? true,
    supportsPlaces: init.supportsPlaces ?? true,
    supportsCreatePlace: init.supportsCreatePlace ?? false,
    close: async () => {},
  };

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { query = '', variables = {} } = JSON.parse(body || '{}') as {
      query?: string;
      variables?: Record<string, unknown>;
    };
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const gqlError = (message: string) => send(400, { errors: [{ message }] });

    if (state.mode === 'unauth') return send(401, { errors: [] });
    if (state.mode === 'echoauth') {
      // A server that quotes the request's Authorization header back in its
      // error — the way a credential ends up on screen if nobody scrubs it.
      return gqlError(`Rejected credential: ${req.headers.authorization ?? '(none)'}`);
    }

    const wantsMetadata = /\bmetadata\b/.test(query);
    const isSearch = /\bsearch\s*\(/.test(query);
    const isPlaces = /\bplaces\s*\(/.test(query);
    const isCreateEvent = /createEvent\s*\(/.test(query);
    const isCreatePlace = /createPlace\s*\(/.test(query);

    if (isCreatePlace) {
      if (!state.supportsCreatePlace) return gqlError('Cannot query field "createPlace" on type "Mutation".');
      const input = (variables.input ?? {}) as { name?: string };
      return send(200, { data: { createPlace: { id: `pl${state.places.length + 1}`, name: input.name } } });
    }

    if (isCreateEvent) {
      const input = (variables.input ?? {}) as Record<string, unknown>;
      // Idempotent on the source triple, exactly like CI-Server.
      const key = `${input.sourceType}|${input.sourceSystem}|${input.sourceId}`;
      const existing = state.created.find(
        (c) => `${c.input.sourceType}|${c.input.sourceSystem}|${c.input.sourceId}` === key,
      );
      const id = existing?.id ?? `ev${state.created.length + 1}`;
      if (existing) existing.input = input;
      else state.created.push({ input, id });

      // Make the write immediately readable, the way a real server would.
      const coords = input.locationCoordinates as FakeEvent['locationCoordinates'];
      const row: FakeEvent = {
        id,
        title: input.title as string | undefined,
        description: input.description as string | undefined,
        startTime: input.startTime as string | undefined,
        endTime: input.endTime as string | undefined,
        locationName: input.locationName as string | undefined,
        locationCoordinates: coords ?? null,
        sourceSystem: (input.sourceSystem as string) ?? null,
        eventType: (input.eventType as string) ?? 'event',
        metadata: (input.metadata as Record<string, unknown>) ?? null,
        timeSource: 'source',
      };
      const at = state.events.findIndex((e) => e.id === id);
      if (at >= 0) state.events[at] = row;
      else state.events.push(row);
      return send(200, { data: { createEvent: { id, title: row.title, startTime: row.startTime } } });
    }

    if (isPlaces) {
      if (!state.supportsPlaces) return gqlError('Cannot query field "places" on type "Query".');
      const first = num(variables.first) ?? 200;
      const after = variables.after as string | undefined;
      const start = after ? state.places.findIndex((p) => `c:${p.id}` === after) + 1 : 0;
      const slice = state.places.slice(start, start + first);
      const last = slice[slice.length - 1];
      return send(200, {
        data: {
          places: {
            totalCount: state.places.length,
            pageInfo: { hasNextPage: start + first < state.places.length, endCursor: last ? `c:${last.id}` : null },
            edges: slice.map((p) => ({ cursor: `c:${p.id}`, node: p })),
          },
        },
      });
    }

    if (!isSearch) return gqlError(`Unknown operation in: ${query.slice(0, 40)}`);

    state.searches.push(variables);
    if (wantsMetadata && !state.supportsMetadata) {
      return gqlError('Cannot query field "metadata" on type "EventType". Did you mean "mediaUrl"?');
    }

    if (state.mode === 'empty') {
      // Byte-for-byte the zero-result shape in the repo-root verify_empty.ts.
      return send(200, { data: { search: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, edges: [] } } });
    }
    if (state.mode === 'malformed') {
      // A proxy/older server that answers with a shape the client didn't expect:
      // `search` present but empty, `edges` not an array, `pageInfo` missing.
      return send(200, { data: { search: { edges: 'not-an-array', totalCount: 'lots' } } });
    }
    if (state.mode === 'stuck') {
      // Claims another page forever and never advances the cursor.
      const e = state.events[0];
      return send(200, {
        data: {
          search: {
            totalCount: 9999,
            pageInfo: { hasNextPage: true, endCursor: 'always-the-same' },
            edges: e ? [project(e, wantsMetadata)] : [],
          },
        },
      });
    }

    const rows = state.events.filter((e) => matches(e, variables));
    // The real server clamps `first` to 100 and says nothing about it.
    const first = Math.min(num(variables.first) ?? 100, 100);
    const after = variables.after as string | undefined;
    const start = after ? rows.findIndex((e) => `c:${e.id}` === after) + 1 : 0;
    const slice = rows.slice(start, start + first);
    const last = slice[slice.length - 1];
    return send(200, {
      data: {
        search: {
          totalCount: rows.length,
          pageInfo: { hasNextPage: start + first < rows.length, endCursor: last ? `c:${last.id}` : null },
          edges: slice.map((e) => project(e, wantsMetadata)),
        },
      },
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  state.url = `http://127.0.0.1:${port}`;
  state.close = () => new Promise<void>((resolve) => { server.close(() => resolve()); });
  return state;
}

/** A located photo memory. */
export function photoEvent(i: number, over: Partial<FakeEvent> = {}): FakeEvent {
  return {
    id: `e${i}`,
    title: `Memory ${i}`,
    startTime: new Date(Date.parse('2019-06-01T00:00:00Z') + i * 3_600_000).toISOString(),
    locationCoordinates: { type: 'Point', coordinates: [-122.4 + i * 0.001, 37.77 + i * 0.001] },
    participantEntityIds: [`person-${i % 3}`],
    mediaContentType: 'image/jpeg',
    previewUrl: `/media/e${i}-thumb.jpg`,
    mediaUrl: `/media/e${i}.jpg`,
    mediaWidth: 4032,
    mediaHeight: 3024,
    timeSource: 'source',
    eventType: 'photo',
    ...over,
  };
}

/** A located memory with no media at all — the dominant shape in a real
 *  archive (calendar entries, trips, orders). */
export function markerEvent(i: number, over: Partial<FakeEvent> = {}): FakeEvent {
  return {
    id: `m${i}`,
    title: `Visit ${i}`,
    startTime: new Date(Date.parse('2019-06-01T00:00:00Z') + i * 7_200_000).toISOString(),
    locationCoordinates: { type: 'Point', coordinates: [-122.5 + i * 0.01, 37.7 + i * 0.01] },
    category: 'calendar',
    timeSource: 'source',
    eventType: 'event',
    ...over,
  };
}
