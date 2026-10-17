import { reportBody } from "./report-body.js";
import type { RankRaft } from "../client.js";
import type { PagePromise } from "../core/pagination.js";
import type {
  BotRow,
  BotsParams,
  CitationRow,
  CitationsParams,
  ReferralRow,
  ReferralsParams,
  SentimentParams,
  SentimentRow,
  VisibilityParams,
  VisibilityRow,
} from "../types.js";

/**
 * The report endpoints.
 *
 * These are POST requests that read nothing but data - the body carries a date
 * range and a filter tree, which is too much to put in a query string. They are
 * marked retryable in the operation table for exactly that reason; nothing here
 * mutates anything.
 *
 * Numbers match the dashboard by construction: both sides score the same facts
 * with the same package, so a Visibility Score here equals the one on screen.
 */
export class ReportsResource {
  readonly #client: RankRaft;
  constructor(client: RankRaft) {
    this.#client = client;
  }

  visibility(params: VisibilityParams & { signal?: AbortSignal }): PagePromise<VisibilityRow> {
    return this.#client.paginateBody<VisibilityRow>("reportVisibility", reportBody(params), params.signal);
  }

  citations(params: CitationsParams & { signal?: AbortSignal }): PagePromise<CitationRow> {
    return this.#client.paginateBody<CitationRow>("reportCitations", reportBody(params), params.signal);
  }

  sentiment(params: SentimentParams & { signal?: AbortSignal }): PagePromise<SentimentRow> {
    return this.#client.paginateBody<SentimentRow>("reportSentiment", reportBody(params), params.signal);
  }

  /** Crawler traffic from your own server logs. Accepts an IANA `timezone`. */
  bots(params: BotsParams & { signal?: AbortSignal }): PagePromise<BotRow> {
    return this.#client.paginateBody<BotRow>("reportBots", reportBody(params), params.signal);
  }

  /** People who arrived from an AI answer. Accepts an IANA `timezone`. */
  referrals(params: ReferralsParams & { signal?: AbortSignal }): PagePromise<ReferralRow> {
    return this.#client.paginateBody<ReferralRow>("reportReferrals", reportBody(params), params.signal);
  }
}
