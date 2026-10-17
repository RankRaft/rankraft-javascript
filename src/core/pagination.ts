import { PaginationError } from "../errors.js";

/**
 * Cursor pagination, where the cursor is bound to a hash of the request body.
 *
 * That binding is the whole reason this file is careful. The body sent on page
 * one is frozen and re-sent verbatim; only `cursor` is substituted. Two things
 * are therefore forbidden, and both are tempting:
 *
 *   - rebuilding the body from `info.filter`. The server echoes a *normalised*
 *     filter, so round-tripping it changes the bytes and page two returns 400.
 *   - re-serialising the caller's object each page. A caller who mutates their
 *     filter inside the loop would silently change the query mid-iteration.
 *
 * `cursor` is always dropped and re-appended last, so every page's body is
 * byte-identical except for one trailing field. A test asserts exactly that.
 */

export interface PageInfo {
  site_id?: string;
  start_date?: string;
  end_date?: string;
  count?: number;
  total_results?: number;
  next_cursor?: string | null;
  filter?: unknown;
  [key: string]: unknown;
}

export function serializeWithCursor(base: Record<string, unknown>, cursor?: string | null): string {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    if (key === "cursor" || value === undefined) continue;
    rest[key] = value;
  }
  if (cursor == null) return JSON.stringify(rest);
  return JSON.stringify({ ...rest, cursor });
}

export type FetchPage<TRow> = (cursor: string | null) => Promise<Page<TRow>>;

export class Page<TRow> {
  readonly data: TRow[];
  readonly info: PageInfo;
  readonly requestId: string | null;
  /** The cursor that produced this page; null for the first. */
  readonly cursor: string | null;
  readonly #fetchPage: FetchPage<TRow>;

  constructor(args: { data: TRow[]; info: PageInfo; requestId: string | null; cursor: string | null; fetchPage: FetchPage<TRow> }) {
    this.data = args.data;
    this.info = args.info;
    this.requestId = args.requestId;
    this.cursor = args.cursor;
    this.#fetchPage = args.fetchPage;
  }

  get nextCursor(): string | null {
    return this.info.next_cursor ?? null;
  }

  hasNextPage(): boolean {
    return this.nextCursor !== null && this.nextCursor !== "";
  }

  async getNextPage(): Promise<Page<TRow>> {
    const next = this.nextCursor;
    if (next === null || next === "") throw new PaginationError("rankraft: there is no next page");
    // Fail closed rather than loop forever. A server that keeps handing back
    // the cursor it was given is a bug, and an infinite loop is the worst way
    // to find out about it.
    if (next === this.cursor) {
      throw new PaginationError(
        `rankraft: the API returned the same cursor twice (${next.slice(0, 12)}…), which would loop forever`,
      );
    }
    return this.#fetchPage(next);
  }

  /** Every row on every page. */
  async *[Symbol.asyncIterator](): AsyncIterator<TRow> {
    let page: Page<TRow> = this;
    for (;;) {
      for (const row of page.data) yield row;
      if (!page.hasNextPage()) return;
      page = await page.getNextPage();
    }
  }

  async *iterPages(): AsyncIterableIterator<Page<TRow>> {
    let page: Page<TRow> = this;
    for (;;) {
      yield page;
      if (!page.hasNextPage()) return;
      page = await page.getNextPage();
    }
  }
}

/**
 * Awaitable for page one, async-iterable for every row.
 *
 * One call site, two behaviours, no second method name to remember:
 *   const page = await client.reports.visibility({...});
 *   for await (const row of client.reports.visibility({...})) {...}
 */
export class PagePromise<TRow> implements PromiseLike<Page<TRow>>, AsyncIterable<TRow> {
  #promise: Promise<Page<TRow>> | null = null;
  readonly #start: () => Promise<Page<TRow>>;

  constructor(start: () => Promise<Page<TRow>>) {
    this.#start = start;
  }

  #first(): Promise<Page<TRow>> {
    // Memoised so `await p` after `for await (… of p)` does not re-request.
    this.#promise ??= this.#start();
    return this.#promise;
  }

  then<TResult1 = Page<TRow>, TResult2 = never>(
    onfulfilled?: ((value: Page<TRow>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.#first().then(onfulfilled, onrejected);
  }

  catch<T = never>(onrejected?: ((reason: unknown) => T | PromiseLike<T>) | null): Promise<Page<TRow> | T> {
    return this.#first().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<Page<TRow>> {
    return this.#first().finally(onfinally);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TRow> {
    const page = await this.#first();
    yield* page;
  }

  async *iterPages(): AsyncIterableIterator<Page<TRow>> {
    const page = await this.#first();
    yield* page.iterPages();
  }

  /** Every row, collected. Convenient for small reports; unbounded by design. */
  async all(): Promise<TRow[]> {
    const rows: TRow[] = [];
    for await (const row of this) rows.push(row);
    return rows;
  }
}
