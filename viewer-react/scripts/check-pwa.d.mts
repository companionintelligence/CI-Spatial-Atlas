// Types for check-pwa.mjs, so the TypeScript tests that import it are checked against its real shape.
export const CACHE_PREFIX: string;

/** Whether this is the text of docs/service-worker-kill-switch.js rather than of the real worker. */
export function isKillSwitch(source: string): boolean;

/** What the service worker names: its cache, the offline page and the files it precaches. */
export function serviceWorkerFiles(source: string): { cache: string | null; offline: string | null; precache: string[] };

/** The 12 hex digits that end the worker's cache name (see check-pwa.mjs). */
export function precacheFingerprint(dir: string, urls: readonly string[]): string;

export function checkSource(publicDir?: string): string[];
export function checkWorkerBuild(dist: string, js: string): string[];
export function checkDist(dist?: string): string[];

/** Throws one Error listing every problem. */
export function assertPwa(options?: { publicDir?: string; dist?: string | null }): void;
