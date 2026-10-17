import { reportBody } from "./report-body.js";
import type { RankRaft } from "../client.js";
import type { PagePromise } from "../core/pagination.js";
import type { AnswerRow, AnswersParams } from "../types.js";

/**
 * Raw stored answers, newest first.
 *
 * Lives at `/v1/answers` rather than under `/v1/reports/`, which is why it is
 * `client.answers.query()` and not `client.reports.answers()` - the client
 * mirrors the routes rather than tidying them, so a path in the docs is
 * findable in the SDK.
 */
export class AnswersResource {
  readonly #client: RankRaft;
  constructor(client: RankRaft) {
    this.#client = client;
  }

  query(params: AnswersParams & { signal?: AbortSignal }): PagePromise<AnswerRow> {
    return this.#client.paginateBody<AnswerRow>("queryAnswers", reportBody(params), params.signal);
  }
}
