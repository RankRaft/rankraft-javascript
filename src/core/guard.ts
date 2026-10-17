import { BrowserEnvironmentError } from "../errors.js";

/**
 * Refuse to be constructed in a browser.
 *
 * This fails at construction rather than at the first request on purpose. The
 * key leaks at *bundle* time - it is in the JavaScript every visitor
 * downloads - long before any request is made, and the request itself would
 * only produce an opaque "TypeError: Failed to fetch" from the CORS preflight,
 * which tells the developer nothing about what they have just published.
 *
 * `window.document` is checked rather than bare `window` because some
 * non-browser runtimes define a `window` global. Cloudflare Workers, Deno, Bun,
 * Node and the Next.js edge runtime all pass; a "use client" bundle does not.
 */
export function isBrowser(): boolean {
  const w = (globalThis as { window?: { document?: { createElement?: unknown } } }).window;
  return typeof w === "object" && w !== null && typeof w.document?.createElement === "function";
}

const MESSAGE = `rankraft was constructed in a browser.

Two separate problems, both fatal:
  1. Your API key would be in your page's JavaScript bundle, readable by every
     visitor. A RankRaft AI key reads every site in your organisation.
  2. api.rankraft.ai sends no CORS headers, deliberately. The request would be
     blocked by the browser before it was ever sent.

Call RankRaft AI from your server instead - a route handler, a server action, a
Cloudflare Worker, or a backend job.

If you are in a browser extension or an Electron main process, where CORS does
not apply and the key is not public, pass { dangerouslyAllowBrowser: true }.`;

let warned = false;

export function assertNotBrowser(allow: boolean): void {
  if (!isBrowser()) return;
  if (!allow) throw new BrowserEnvironmentError(MESSAGE);
  if (!warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn("rankraft: dangerouslyAllowBrowser is set. Your API key is readable by anyone who can open this page.");
  }
}

/** Test seam: the warning is once per process, which would leak between tests. */
export function resetBrowserWarning(): void {
  warned = false;
}
