/**
 * Device location and nearby alerts, as logic: distance, the 300 m check, the
 * once-per-session dedupe, and how platform permission states become UI states.
 *
 * The module under test has no DOM, Capacitor or Cesium imports, so these are
 * plain unit tests. The device calls and the hook are thin and are not covered
 * here.
 */
import { describe, expect, it } from 'vitest';
import {
  NEARBY_RADIUS_METRES,
  devicePositionFrom,
  haversineMetres,
  locationAccessFromState,
  locationNote,
  nearbyMemories,
  nearbyNotice,
  notificationAccessFromState,
  notificationIdFor,
  notifyNote,
  statusForGeolocationError,
  statusForLocationAccess,
  statusForNotificationAccess,
  takeUnannounced,
  validLatLon,
  type LocatedMemory,
  type NearbyMemory,
} from '../src/location/logic.js';

/** One degree of latitude on the mean sphere, in metres. */
const METRES_PER_DEGREE = 111_195.08;

const here = { lat: 51.5, lon: 0 };

/** A memory `metres` north of `here`, using the same sphere as the code under test. */
const northOf = (id: string, metres: number, title = `Memory ${id}`): LocatedMemory => ({
  id,
  title,
  lat: here.lat + metres / METRES_PER_DEGREE,
  lon: here.lon,
});

describe('haversineMetres', () => {
  it('is zero for the same point', () => {
    expect(haversineMetres(here, { ...here })).toBe(0);
  });

  it('measures one degree of latitude as about 111.2 km', () => {
    const d = haversineMetres({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(Math.abs(d - METRES_PER_DEGREE)).toBeLessThan(1);
  });

  it('measures one degree of longitude at the equator the same as one of latitude', () => {
    const d = haversineMetres({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(Math.abs(d - METRES_PER_DEGREE)).toBeLessThan(1);
  });

  it('is symmetric', () => {
    const a = { lat: 51.5074, lon: -0.1278 };
    const b = { lat: 48.8566, lon: 2.3522 };
    expect(haversineMetres(a, b)).toBeCloseTo(haversineMetres(b, a), 6);
  });

  it('gives London to Paris as about 344 km', () => {
    const d = haversineMetres({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 });
    expect(d).toBeGreaterThan(343_000);
    expect(d).toBeLessThan(344_000);
  });
});

describe('validLatLon', () => {
  it('accepts coordinates inside the valid ranges, including the edges', () => {
    expect(validLatLon(90, 180)).toEqual({ lat: 90, lon: 180 });
    expect(validLatLon(-90, -180)).toEqual({ lat: -90, lon: -180 });
  });

  it('rejects out-of-range, non-numeric and non-finite values', () => {
    expect(validLatLon(91, 0)).toBeNull();
    expect(validLatLon(0, 181)).toBeNull();
    expect(validLatLon('51.5', 0)).toBeNull();
    expect(validLatLon(undefined, 0)).toBeNull();
    expect(validLatLon(0, Number.NaN)).toBeNull();
    expect(validLatLon(Number.POSITIVE_INFINITY, 0)).toBeNull();
  });
});

describe('nearbyMemories', () => {
  it('uses a 300 m radius by default', () => {
    expect(NEARBY_RADIUS_METRES).toBe(300);
  });

  it('includes a memory about 290 m away and excludes one about 310 m away', () => {
    const found = nearbyMemories(here, [northOf('near', 290), northOf('far', 310)]);
    expect(found.map((m) => m.id)).toEqual(['near']);
    expect(found[0]!.distanceMetres).toBeLessThan(NEARBY_RADIUS_METRES);
  });

  it('includes a memory at the exact position', () => {
    const found = nearbyMemories(here, [{ id: 'here', title: 'Here', lat: here.lat, lon: here.lon }]);
    expect(found).toEqual([{ id: 'here', title: 'Here', distanceMetres: 0 }]);
  });

  it('sorts nearest first', () => {
    const found = nearbyMemories(here, [northOf('c', 250), northOf('a', 50), northOf('b', 120)]);
    expect(found.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('skips memories without a usable coordinate instead of placing them', () => {
    const found = nearbyMemories(here, [
      { id: 'none', title: 'No place' },
      { id: 'nan', title: 'Bad', lat: Number.NaN, lon: 0 },
      { id: 'range', title: 'Out of range', lat: 95, lon: 0 },
    ]);
    expect(found).toEqual([]);
  });

  it('treats 0,0 as a real coordinate, not a missing one', () => {
    expect(validLatLon(0, 0)).toEqual({ lat: 0, lon: 0 });
  });

  it('honours an explicit radius', () => {
    const found = nearbyMemories(here, [northOf('a', 80)], 50);
    expect(found).toEqual([]);
  });
});

describe('takeUnannounced', () => {
  const near = (id: string): NearbyMemory => ({ id, title: id, distanceMetres: 10 });

  it('returns every candidate the first time and records each id', () => {
    const announced = new Set<string>();
    const fresh = takeUnannounced(announced, [near('a'), near('b')]);
    expect(fresh.map((m) => m.id)).toEqual(['a', 'b']);
    expect([...announced].sort()).toEqual(['a', 'b']);
  });

  it('returns nothing for memories already announced this session', () => {
    const announced = new Set<string>(['a']);
    expect(takeUnannounced(announced, [near('a')])).toEqual([]);
  });

  it('returns only the new memories on a later check', () => {
    const announced = new Set<string>();
    takeUnannounced(announced, [near('a')]);
    const later = takeUnannounced(announced, [near('a'), near('b')]);
    expect(later.map((m) => m.id)).toEqual(['b']);
  });

  it('counts a memory listed twice in one check once', () => {
    const announced = new Set<string>();
    const fresh = takeUnannounced(announced, [near('a'), near('a')]);
    expect(fresh).toHaveLength(1);
  });
});

describe('notificationIdFor', () => {
  const ids = ['a', 'b', 'c', 'memory-1', 'memory-2', 'a-much-longer-memory-identifier'];

  it('returns a positive 31-bit integer, which Capacitor accepts', () => {
    for (const id of ids) {
      const n = notificationIdFor(id);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(0x7fffffff);
    }
  });

  it('is stable for the same memory', () => {
    expect(notificationIdFor('memory-1')).toBe(notificationIdFor('memory-1'));
  });

  it('gives distinct memories distinct ids', () => {
    expect(new Set(ids.map(notificationIdFor)).size).toBe(ids.length);
  });
});

describe('nearbyNotice', () => {
  it('names the memory and the radius, and gives no exact distance', () => {
    expect(nearbyNotice({ title: 'Harbour walk' })).toEqual({
      title: 'Memory nearby',
      body: 'Harbour walk is within 300 m of you.',
    });
  });

  it('falls back to a generic name for a blank title', () => {
    expect(nearbyNotice({ title: '   ' }).body).toBe('A memory is within 300 m of you.');
  });
});

describe('devicePositionFrom', () => {
  it('reads the latitude, longitude and accuracy', () => {
    expect(
      devicePositionFrom({ coords: { latitude: 51.5, longitude: -0.12, accuracy: 12 } }),
    ).toEqual({ lat: 51.5, lon: -0.12, accuracyMetres: 12 });
  });

  it('returns null when the fix is missing or its coordinates are not usable', () => {
    expect(devicePositionFrom(null)).toBeNull();
    expect(devicePositionFrom(undefined)).toBeNull();
    expect(devicePositionFrom({ coords: { latitude: Number.NaN, longitude: 0 } })).toBeNull();
  });

  it('reports an absent or negative accuracy as unknown', () => {
    expect(devicePositionFrom({ coords: { latitude: 1, longitude: 1 } })?.accuracyMetres).toBeNull();
    expect(
      devicePositionFrom({ coords: { latitude: 1, longitude: 1, accuracy: -1 } })?.accuracyMetres,
    ).toBeNull();
  });
});

describe('permission states', () => {
  it('reads location access from the platform state', () => {
    expect(locationAccessFromState('granted')).toBe('granted');
    expect(locationAccessFromState('denied')).toBe('denied');
    expect(locationAccessFromState('prompt')).toBe('prompt');
    expect(locationAccessFromState('prompt-with-rationale')).toBe('prompt');
    expect(locationAccessFromState('something-new')).toBe('unavailable');
    expect(locationAccessFromState(undefined)).toBe('unavailable');
  });

  it('reads notification access from the platform state, refusing anything it does not know', () => {
    expect(notificationAccessFromState('granted')).toBe('granted');
    expect(notificationAccessFromState('prompt')).toBe('prompt');
    expect(notificationAccessFromState('denied')).toBe('denied');
    expect(notificationAccessFromState('something-new')).toBe('denied');
  });

  it('maps location access to the control status', () => {
    expect(statusForLocationAccess('granted')).toBe('waiting');
    expect(statusForLocationAccess('denied')).toBe('denied');
    // A prompt the user dismissed is not a grant. A tap on the control asks again.
    expect(statusForLocationAccess('prompt')).toBe('denied');
    expect(statusForLocationAccess('unavailable')).toBe('unavailable');
  });

  it('maps notification access to the control status', () => {
    expect(statusForNotificationAccess('granted')).toBe('on');
    expect(statusForNotificationAccess('denied')).toBe('blocked');
    expect(statusForNotificationAccess('prompt')).toBe('off');
    expect(statusForNotificationAccess('unsupported')).toBe('unsupported');
  });
});

describe('statusForGeolocationError', () => {
  it('maps the web GeolocationPositionError codes', () => {
    expect(statusForGeolocationError({ code: 1 })).toBe('denied');
    expect(statusForGeolocationError({ code: 2 })).toBe('unavailable');
    expect(statusForGeolocationError({ code: 3 })).toBe('waiting');
  });

  it('maps the Capacitor plugin codes', () => {
    expect(statusForGeolocationError({ code: 'OS-PLUG-GLOC-0003' })).toBe('denied');
    expect(statusForGeolocationError({ code: 'OS-PLUG-GLOC-0008' })).toBe('denied');
    expect(statusForGeolocationError({ code: 'OS-PLUG-GLOC-0007' })).toBe('unavailable');
    expect(statusForGeolocationError({ code: 'OS-PLUG-GLOC-0010' })).toBe('waiting');
    expect(statusForGeolocationError({ code: 'OS-PLUG-GLOC-0018' })).toBe('error');
  });

  it('treats anything else as an error', () => {
    expect(statusForGeolocationError(undefined)).toBe('error');
    expect(statusForGeolocationError(null)).toBe('error');
    expect(statusForGeolocationError('nope')).toBe('error');
    expect(statusForGeolocationError({ code: 99 })).toBe('error');
  });
});

describe('user-facing notes', () => {
  it('shows nothing while the control is off or working', () => {
    expect(locationNote('off')).toBeNull();
    expect(locationNote('requesting')).toBeNull();
    expect(locationNote('tracking')).toBeNull();
  });

  it('says what to do when location is refused', () => {
    const note = locationNote('denied');
    expect(note).toContain('device settings');
    expect(note).toContain('Companion Atlas');
  });

  it('explains a missing fix and an unavailable position', () => {
    expect(locationNote('waiting')).toBe('Finding your position.');
    expect(locationNote('unavailable')).toBeTruthy();
    expect(locationNote('error')).toBeTruthy();
  });

  it('shows nothing for notifications that are off or on', () => {
    expect(notifyNote('off')).toBeNull();
    expect(notifyNote('on')).toBeNull();
  });

  it('says what to do when notifications are blocked or unavailable', () => {
    expect(notifyNote('blocked')).toContain('device settings');
    expect(notifyNote('unsupported')).toBeTruthy();
  });
});
