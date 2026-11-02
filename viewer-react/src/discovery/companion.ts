/**
 * Companion Hub discovery: how the viewer finds the Companion Memory server and
 * an LLM resource without the operator typing their URLs into the build.
 *
 * The Hub publishes a small JSON document at `<hub>/.well-known/companion-resources`.
 * Its shape is the contract in docs/DISCOVERY.md. Until the Hub publishes it,
 * discovery finds nothing and the viewer uses VITE_MEMORY_URL or the bundled
 * sample, exactly as before.
 */

export interface CompanionMemory {
  /** Base URL of the Companion Memory server, e.g. `https://memory.example/api`. */
  url: string;
}

export interface CompanionLlm {
  /**
   * Base URL of an LLM endpoint. It is recorded and shown in the shell, but
   * nothing calls it yet: "Curate" still runs in the browser (docs/DISCOVERY.md).
   */
  url: string;
  provider?: string;
  models?: string[];
}

export interface CompanionResources {
  memory?: CompanionMemory;
  llm?: CompanionLlm;
}

export const RESOURCES_PATH = '/.well-known/companion-resources';
export const DISCOVERY_TIMEOUT_MS = 5_000;

/**
 * A service URL the viewer will send requests to. Accept https, and plain http
 * only for a local development host. Refuse credentials, other schemes and
 * anything that is not a URL.
 */
export function safeServiceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.test');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/** The Companion Hub base from the build environment, or null when discovery is off. */
export function companionHubFromEnv(env: Record<string, string | undefined>): string | null {
  return safeServiceUrl(env.VITE_COMPANION_HUB_URL);
}

/** Keep the fields this viewer understands and drop everything else. */
export function parseCompanionResources(json: unknown): CompanionResources | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const doc = json as Record<string, unknown>;
  const out: CompanionResources = {};

  const memory = doc.memory;
  if (memory && typeof memory === 'object') {
    const url = safeServiceUrl((memory as Record<string, unknown>).url);
    if (url) out.memory = { url };
  }

  const llm = doc.llm;
  if (llm && typeof llm === 'object') {
    const entry = llm as Record<string, unknown>;
    const url = safeServiceUrl(entry.url);
    if (url) {
      const provider = typeof entry.provider === 'string' ? entry.provider.slice(0, 64) : undefined;
      const models = Array.isArray(entry.models)
        ? entry.models.filter((m): m is string => typeof m === 'string').slice(0, 20).map((m) => m.slice(0, 100))
        : [];
      out.llm = {
        url,
        ...(provider ? { provider } : {}),
        ...(models.length > 0 ? { models } : {}),
      };
    }
  }

  return out.memory || out.llm ? out : null;
}

/**
 * Fetch the Hub's resource document. Any failure (no document, a network or CORS
 * error, a timeout, or a body that is not JSON) returns null, so the caller falls
 * back. Credentials are omitted: discovery must not send a Hub session to anyone.
 */
export async function discoverCompanionResources(
  hubUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DISCOVERY_TIMEOUT_MS,
): Promise<CompanionResources | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${hubUrl}${RESOURCES_PATH}`, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parseCompanionResources(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
