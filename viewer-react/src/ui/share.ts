/** Copy a share-safe URL and return whether the browser accepted the write. */
export async function copyShareUrl(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Some embedded browsers expose the Clipboard API but reject it from an
    // insecure context. Fall through to the legacy user-gesture path below.
  }

  // Tailscale/local HTTP previews are not secure contexts, so Clipboard API
  // access can be unavailable even though copying is still safe and useful.
  // Keep this fallback scoped to the click's call stack; browsers allow the
  // execCommand copy only while the user gesture is active.
  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') return false;
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  input.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input.remove();
  }
}
