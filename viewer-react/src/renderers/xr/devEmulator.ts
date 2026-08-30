/**
 * Dev-only WebXR device emulation, so the immersive path can be exercised
 * without a headset.
 *
 * The XR renderer was previously unverifiable: `navigator.xr` does not exist in
 * a normal desktop browser, so nothing past "the canvas mounts" could be
 * checked, and grab locomotion rested entirely on unit tests of its maths.
 * `iwer` is the runtime behind Meta's Immersive Web Emulator extension — the
 * same emulation, but installed by the page instead of by a browser extension,
 * which means it also works in automation and in any browser.
 *
 * Opt-in via `?xremu` (optionally `?xremu=quest2|quest3|questPro|generic`).
 * Never on by default and never in a production build: it replaces
 * `navigator.xr` wholesale, and shipping that would hide a real headset from
 * real users. `installRuntime` already declines when a native `navigator.xr` is
 * present, but the build-time guard is what keeps it out of the bundle at all.
 */
import type { XRDevice as XRDeviceType } from 'iwer';

const PROFILES = ['generic', 'metaQuest2', 'metaQuest3', 'metaQuestPro'] as const;
type ProfileName = (typeof PROFILES)[number];

const ALIASES: Record<string, ProfileName> = {
  '': 'metaQuest3',
  '1': 'metaQuest3',
  quest: 'metaQuest3',
  quest2: 'metaQuest2',
  quest3: 'metaQuest3',
  questpro: 'metaQuestPro',
  pro: 'metaQuestPro',
  generic: 'generic',
};

/** The emulated device, exposed for tests and for driving input from the console. */
declare global {
  interface Window {
    __atlasXRDevice?: XRDeviceType;
  }
}

/**
 * Install the emulated device if `?xremu` is present. Returns true when a
 * runtime was installed. Must be awaited before the app mounts — the R3F XR
 * store reads `navigator.xr` during setup, and installing afterwards leaves it
 * believing the browser has no XR support.
 */
export async function maybeInstallXREmulator(): Promise<boolean> {
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (!env?.DEV) return false;

  const params = new URLSearchParams(window.location.search);
  if (!params.has('xremu')) return false;

  // Never shadow a real device — but "has navigator.xr" is not the same as "has
  // a headset". Desktop Chromium ships the WebXR API and reports
  // immersive-vr unsupported with no device attached, so a presence check
  // declined to install the emulator on exactly the browsers that need it. Ask
  // whether an immersive session is actually available instead.
  if (navigator.xr) {
    const alreadyImmersive = await navigator.xr
      .isSessionSupported('immersive-vr')
      .catch(() => false);
    if (alreadyImmersive) {
      console.info('[atlas] real WebXR device present; skipping the emulator');
      return false;
    }
  }

  const requested = (params.get('xremu') ?? '').toLowerCase();
  const profile = ALIASES[requested] ?? (PROFILES as readonly string[]).includes(requested)
    ? (ALIASES[requested] ?? (requested as ProfileName))
    : 'metaQuest3';

  try {
    const iwer = await import('iwer');
    const config = (iwer as unknown as Record<string, unknown>)[profile] ?? iwer.metaQuest3;
    const device = new iwer.XRDevice(config as never);
    // forceInstall, because desktop Chromium exposes a `navigator.xr` that
    // supports no session at all. iwer declines to clobber any native runtime
    // by default and warns instead, which on these browsers means the emulator
    // silently never installs. The guard above has already established there is
    // no real immersive device to shadow, so overriding here is safe.
    device.installRuntime({ forceInstall: true });
    window.__atlasXRDevice = device;
    console.info(`[atlas] WebXR emulator installed (${profile}) — this is not a real headset`);
    return true;
  } catch (e) {
    console.error('[atlas] failed to install the WebXR emulator', e);
    return false;
  }
}
