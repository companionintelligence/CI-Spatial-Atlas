/**
 * The native shell's Keychain, reached through the bridge Capacitor injects.
 *
 * The web bundle never imports Capacitor (viewer-react/mobile/README.md explains
 * why), so the secure-storage plugin is called through `window.Capacitor.Plugins`,
 * the object the bridge fills with the shell's plugins. Outside the shell there is
 * no bridge, and nothing here reads or writes anything.
 */

interface SecureStorage {
  get(options: { key: string }): Promise<{ value: string }>;
  set(options: { key: string; value: string }): Promise<{ value: boolean }>;
  remove(options: { key: string }): Promise<{ value: boolean }>;
}

interface NativeBridge {
  isNativePlatform?: () => boolean;
  Plugins?: { SecureStoragePlugin?: SecureStorage };
}

function bridge(): NativeBridge | undefined {
  return (globalThis as unknown as { Capacitor?: NativeBridge }).Capacitor;
}

function keychain(): SecureStorage | undefined {
  return bridge()?.Plugins?.SecureStoragePlugin;
}

/** True inside the Capacitor shell, false in a browser or a test. */
export function isNativeShell(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

/** The stored value, or null when nothing is stored or the Keychain is unreachable. */
export async function readSecret(key: string): Promise<string | null> {
  const store = keychain();
  if (!store) return null;

  try {
    const { value } = await store.get({ key });
    return value || null;
  } catch {
    // The plugin rejects a key it has never stored, so a rejection is the normal empty case.
    return null;
  }
}

/** Store a value. Returns false when the Keychain refuses it. */
export async function writeSecret(key: string, value: string): Promise<boolean> {
  const store = keychain();
  if (!store) return false;

  try {
    return (await store.set({ key, value })).value;
  } catch {
    return false;
  }
}

/** Remove a stored value. A key that was never stored is not an error. */
export async function removeSecret(key: string): Promise<void> {
  try {
    await keychain()?.remove({ key });
  } catch {
    // Already absent, which is the state we wanted.
  }
}
