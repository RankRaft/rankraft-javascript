import type { FetchLike } from "../src/index.js";

export interface Reply {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A fetch that replays canned replies and records what it was asked to send. */
export function fakeFetch(replies: Reply[]): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    calls.push({
      url,
      method: init.method ?? "GET",
      headers,
      body: typeof init.body === "string" ? init.body : null,
    });
    const reply = replies[Math.min(i, replies.length - 1)] ?? {};
    i += 1;
    const payload = reply.text ?? JSON.stringify(reply.body ?? {});
    return new Response(payload, {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...(reply.headers ?? {}) },
    });
  };
  return { fetch, calls };
}

export const KEY = "rr_api_TESTKEY_do_not_log_me_0123456789";

export function envelope(data: unknown, info: Record<string, unknown> = {}): Reply {
  return { body: { info, data } };
}
