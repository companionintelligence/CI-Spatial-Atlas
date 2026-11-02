/**
 * The address the viewer reloads into to connect a Companion Memory: the current page with
 * `?memory=` set to the address the person typed. Null when the typed value is not an
 * http(s) address, so the sheet can say why instead of reloading into a broken link.
 *
 * Pure, so the rule that decides what a visitor is connected to is testable on its own.
 */
export function memoryConnectHref(currentHref: string, address: string): string | null {
  let memory: URL;

  try {
    memory = new URL(address.trim());
  } catch {
    return null;
  }

  if (memory.protocol !== 'https:' && memory.protocol !== 'http:') {
    return null;
  }

  const next = new URL(currentHref);

  next.searchParams.set('memory', memory.href);

  return next.href;
}
