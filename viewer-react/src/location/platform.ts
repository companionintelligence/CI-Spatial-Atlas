/**
 * The device edge of the location feature.
 *
 * Inside the native shell this uses the Capacitor plugins that the shell
 * registers (`window.Capacitor.Plugins`). In a browser it uses the Web APIs.
 * Nothing here keeps a position or sends one. The rules live in ./logic.ts.
 *
 * The viewer web bundle never imports @capacitor/*: the plugins are read from
 * the bridge at call time, so the same bundle runs in both places.
 */
import {
  devicePositionFrom,
  locationAccessFromState,
  notificationAccessFromState,
  statusForGeolocationError,
  type DevicePosition,
  type LocationAccess,
  type LocationStatus,
  type NearbyNotice,
  type NotificationAccess,
  type PositionFix,
} from './logic.js';

/** The slice of @capacitor/geolocation the viewer calls. */
interface CapGeolocation {
  checkPermissions(): Promise<{ location: string }>;
  requestPermissions(options: { permissions: string[] }): Promise<{ location: string }>;
  watchPosition(
    options: { enableHighAccuracy?: boolean; maximumAge?: number; timeout?: number },
    callback: (position: PositionFix | null, error?: unknown) => void,
  ): Promise<string>;
  clearWatch(options: { id: string }): Promise<void>;
}

/** The slice of @capacitor/local-notifications the viewer calls. */
interface CapLocalNotifications {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(options: {
    notifications: Array<{ id: number; title: string; body: string }>;
  }): Promise<unknown>;
}

interface CapacitorBridge {
  Plugins?: { Geolocation?: CapGeolocation; LocalNotifications?: CapLocalNotifications };
}

/** The Capacitor plugins, when this page runs inside the native shell. */
function nativePlugins(): CapacitorBridge['Plugins'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor?.Plugins;
}

/**
 * Watch settings. High accuracy, because the nearby check is 300 m and a
 * network-only fix can be off by more than that. Foreground use only, so the
 * battery cost is bounded by the time the app is open.
 */
const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 } as const;

/**
 * Location access as it stands, asking the platform first when the native shell
 * has not been answered. Called from the toggle, so a prompt follows a tap.
 *
 * On the web nothing can be checked in advance. The browser shows its prompt
 * when the watch starts and reports a refusal as error code 1, so this reports
 * 'granted' and lets the watch decide.
 */
export async function ensureLocationAccess(): Promise<LocationAccess> {
  const geolocation = nativePlugins()?.Geolocation;
  if (!geolocation) {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'granted' : 'unavailable';
  }
  try {
    let access = locationAccessFromState((await geolocation.checkPermissions()).location);
    if (access === 'prompt') {
      access = locationAccessFromState(
        (await geolocation.requestPermissions({ permissions: ['location'] })).location,
      );
    }
    return access;
  } catch {
    // Location services switched off at the OS level make the check throw.
    return 'unavailable';
  }
}

/**
 * Start watching the device position. Resolves to the function that stops the
 * watch. `onFix` receives each usable fix; `onError` receives the status a
 * failure means. The platform decides when to stop reporting, so the caller
 * owns the restart.
 */
export async function watchDevicePosition(
  onFix: (position: DevicePosition) => void,
  onError: (status: LocationStatus) => void,
): Promise<() => void> {
  const geolocation = nativePlugins()?.Geolocation;
  if (geolocation) {
    const id = await geolocation.watchPosition(WATCH_OPTIONS, (position, error) => {
      if (position) {
        const fix = devicePositionFrom(position);
        if (fix) onFix(fix);
        return;
      }
      onError(statusForGeolocationError(error));
    });
    return () => {
      void geolocation.clearWatch({ id });
    };
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError('unavailable');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (position) => {
      const fix = devicePositionFrom(position);
      if (fix) onFix(fix);
    },
    (error) => onError(statusForGeolocationError(error)),
    WATCH_OPTIONS,
  );
  return () => navigator.geolocation.clearWatch(id);
}

function webNotificationAccess(permission: NotificationPermission): NotificationAccess {
  if (permission === 'granted') return 'granted';
  if (permission === 'denied') return 'denied';
  return 'prompt';
}

/**
 * Ask for notification access. Called only from the "Nearby memories" tap. The
 * first call is made before any await, so the browser sees it as the tap itself.
 */
export async function requestNotificationAccess(): Promise<NotificationAccess> {
  const notifications = nativePlugins()?.LocalNotifications;
  try {
    if (notifications) {
      return notificationAccessFromState((await notifications.requestPermissions()).display);
    }
    if (typeof Notification === 'undefined') return 'unsupported';
    return webNotificationAccess(await Notification.requestPermission());
  } catch {
    // The request failed, so nothing was granted or refused. Stay off without
    // reporting it as a block.
    return 'prompt';
  }
}

/**
 * Show one nearby alert now. Native: a local notification with no schedule,
 * which the plugin fires at once. Web: a Notification, or the service worker's
 * showNotification where the page cannot make one (Chromium on Android).
 */
export async function showNearbyAlert(id: number, notice: NearbyNotice): Promise<void> {
  const notifications = nativePlugins()?.LocalNotifications;
  if (notifications) {
    await notifications.schedule({
      notifications: [{ id, title: notice.title, body: notice.body }],
    });
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(notice.title, { body: notice.body, tag: String(id) });
    return;
  } catch {
    // Fall through to the service worker.
  }
  const registration = await navigator.serviceWorker?.getRegistration();
  await registration?.showNotification(notice.title, { body: notice.body, tag: String(id) });
}
