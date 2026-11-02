/**
 * React wiring for "Show my location" and "Nearby memories".
 *
 * The rules are in ./logic.ts and the device calls in ./platform.ts. This file
 * joins them to the viewer: the position watch, the foreground-only rule, the
 * marker on the globe, and the nearby alerts. Everything stays in memory.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import {
  locationNote,
  nearbyMemories,
  nearbyNotice,
  notificationIdFor,
  notifyNote,
  statusForLocationAccess,
  statusForNotificationAccess,
  takeUnannounced,
  type DevicePosition,
  type LocatedMemory,
  type LocationStatus,
  type NotifyStatus,
} from './logic.js';
import {
  ensureLocationAccess,
  requestNotificationAccess,
  showNearbyAlert,
  watchDevicePosition,
} from './platform.js';

/** How long to wait before starting a stopped watch again. */
const RETRY_MS = 5_000;

const NO_MEMORIES: readonly LocatedMemory[] = [];

/** Foreground means the page is visible. Read on demand, never at import. */
const inForeground = (): boolean =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden';

export interface DeviceLocation {
  /** "Show my location" is on. */
  locating: boolean;
  /** "Nearby memories" is on. Only ever true while `locating` is. */
  nearby: boolean;
  /** The last fix. Held in memory; never stored, logged or sent. */
  position: DevicePosition | null;
  /** A short message for the top bar, or null. */
  note: string | null;
  toggleLocating: () => void;
  toggleNearby: () => void;
}

export function useDeviceLocation({
  viewer,
  memories = NO_MEMORIES,
}: {
  viewer: Cesium.Viewer | null;
  memories?: readonly LocatedMemory[];
}): DeviceLocation {
  const [locating, setLocating] = useState(false);
  const [nearby, setNearby] = useState(false);
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [status, setStatus] = useState<LocationStatus>('off');
  const [notify, setNotify] = useState<NotifyStatus>('off');
  // Memory ids already announced this session. A ref because nothing renders from it.
  const announced = useRef(new Set<string>());
  const locatingRef = useRef(locating);
  locatingRef.current = locating;
  // A pending notification prompt must not switch alerts on after location was
  // turned off while it was open. Each "location off" starts a new epoch.
  const asking = useRef(false);
  const epoch = useRef(0);

  // The watch runs only while location is on AND the page is in the foreground.
  useEffect(() => {
    if (!locating) return undefined;
    let live = true;
    let starting = false;
    let stop: (() => void) | null = null;
    let retry: number | null = null;

    const halt = () => {
      const stopWatch = stop;
      stop = null;
      stopWatch?.();
    };
    const cancelRetry = () => {
      if (retry !== null) window.clearTimeout(retry);
      retry = null;
    };

    const start = async (): Promise<void> => {
      if (!live || stop || starting || !inForeground()) return;
      starting = true;
      try {
        const access = await ensureLocationAccess();
        if (!live) return;
        const next = statusForLocationAccess(access);
        if (next !== 'waiting') {
          setStatus(next);
          return;
        }
        if (!inForeground()) return;
        setStatus('waiting');
        const stopWatch = await watchDevicePosition(
          (fix) => {
            // A fix that lands after the page went to the background is dropped.
            if (!live || !inForeground()) return;
            setPosition(fix);
            setStatus('tracking');
          },
          (failure) => {
            if (!live || !inForeground()) return;
            setStatus(failure);
            halt();
            // A denial is the user's answer, so it waits for the next tap. Any
            // other failure is retried, because the platform can stop a watch on
            // its own (iOS clears it after a timeout).
            if (failure !== 'denied' && retry === null) {
              retry = window.setTimeout(() => {
                retry = null;
                void start();
              }, RETRY_MS);
            }
          },
        );
        if (!live || !inForeground()) {
          stopWatch();
          return;
        }
        stop = stopWatch;
      } finally {
        starting = false;
      }
    };

    const onVisibility = () => {
      if (inForeground()) {
        void start();
      } else {
        cancelRetry();
        halt();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    void start();

    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisibility);
      cancelRetry();
      halt();
    };
  }, [locating]);

  // Nearby alerts: each memory at most once per session, and only in the foreground.
  useEffect(() => {
    if (!nearby || !position || !inForeground()) return;
    const fresh = takeUnannounced(announced.current, nearbyMemories(position, memories));
    for (const memory of fresh) {
      showNearbyAlert(notificationIdFor(memory.id), nearbyNotice(memory)).catch((error: unknown) => {
        console.warn('[atlas] could not show a nearby alert', error);
      });
    }
  }, [nearby, position, memories]);

  // The marker: one data source for the viewer's lifetime. The dot is shown only
  // while there is a fix, so an idle globe carries an empty source and nothing else.
  const marker = useRef<{ source: Cesium.CustomDataSource; dot: Cesium.Entity } | null>(null);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return undefined;
    const source = new Cesium.CustomDataSource('atlas-device');
    const dot = source.entities.add({
      id: 'device:position',
      show: false,
      point: {
        pixelSize: 12,
        color: Cesium.Color.DODGERBLUE,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      ellipse: {
        semiMajorAxis: 1,
        semiMinorAxis: 1,
        material: Cesium.Color.DODGERBLUE.withAlpha(0.18),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
    marker.current = { source, dot };
    // dataSources.add resolves on a microtask while remove() is synchronous, so
    // the removal waits for the add, as the memory layer does.
    const added = viewer.dataSources.add(source);
    return () => {
      marker.current = null;
      void added.then((d) => {
        if (!viewer.isDestroyed()) viewer.dataSources.remove(d ?? source, true);
      });
    };
  }, [viewer]);

  useEffect(() => {
    const current = marker.current;
    if (!current || !viewer || viewer.isDestroyed()) return;
    const { dot } = current;
    if (!position) {
      dot.show = false;
    } else {
      dot.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(position.lon, position.lat),
      );
      dot.show = true;
      const ring = dot.ellipse;
      if (ring) {
        const radius = Math.max(position.accuracyMetres ?? 0, 5);
        ring.semiMajorAxis = new Cesium.ConstantProperty(radius);
        ring.semiMinorAxis = new Cesium.ConstantProperty(radius);
        ring.show = new Cesium.ConstantProperty(position.accuracyMetres !== null);
      }
    }
    // The viewer does not render on a timer, so ask for the frame that shows this.
    viewer.scene.requestRender();
  }, [viewer, position]);

  const toggleLocating = useCallback(() => {
    if (locating) {
      // Nearby alerts need a position, so they stop with location.
      epoch.current += 1;
      setLocating(false);
      setNearby(false);
      setPosition(null);
      return;
    }
    setStatus('requesting');
    setLocating(true);
  }, [locating]);

  const toggleNearby = useCallback(() => {
    if (nearby) {
      setNearby(false);
      return;
    }
    if (asking.current) return;
    asking.current = true;
    const startedIn = epoch.current;
    // Notification access is requested here, from the tap, and nowhere else. The
    // request is made before any await, so the browser sees the tap itself.
    void requestNotificationAccess().then((access) => {
      asking.current = false;
      const next = statusForNotificationAccess(access);
      setNotify(next);
      if (next !== 'on') {
        setNearby(false);
        return;
      }
      if (startedIn !== epoch.current) return;
      if (!locatingRef.current) {
        setStatus('requesting');
        setLocating(true);
      }
      setNearby(true);
    });
  }, [nearby]);

  return {
    locating,
    nearby,
    position,
    note: locationNote(locating ? status : 'off') ?? notifyNote(notify),
    toggleLocating,
    toggleNearby,
  };
}
