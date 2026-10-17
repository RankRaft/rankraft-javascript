import { toDay } from "../client.js";
import { validateFilter } from "../filters.js";
import type { DateInput } from "../types.js";

interface Ranged {
  start_date: DateInput;
  end_date: DateInput;
  filter?: unknown;
  signal?: AbortSignal;
}

/**
 * Turn report parameters into the object the paginator will freeze.
 *
 * Undefined keys are dropped rather than serialised as `null` (the API's
 * objects are strict, and `null` where a string belongs is a 422), and the
 * filter is grammar-checked here so a malformed node fails in the caller's
 * stack frame instead of coming back one round trip later. Only the grammar:
 * depth and list length are the server's limits and are not copied.
 */
export function reportBody<T extends Ranged>(params: T): Record<string, unknown> {
  const { start_date, end_date, signal: _signal, ...rest } = params;
  if (rest.filter !== undefined) validateFilter(rest.filter);

  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest as Record<string, unknown>)) {
    if (value === undefined) continue;
    body[key] = value;
  }
  body["start_date"] = toDay(start_date);
  body["end_date"] = toDay(end_date);
  return body;
}
