export { RankRaft, toDay, type RankRaftOptions } from "./client.js";
export { VERSION, SPEC_VERSION } from "./version.js";
export { OPERATIONS, expandPath, type Operation, type OperationName } from "./operations.js";

export {
  RankRaftError,
  ConfigurationError,
  BrowserEnvironmentError,
  APIConnectionError,
  APITimeoutError,
  PaginationError,
  APIError,
  BadRequestError,
  InvalidCursorError,
  AuthenticationError,
  PlanRequiredError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  PayloadTooLargeError,
  ValidationError,
  PromptLimitError,
  RateLimitError,
  InternalServerError,
  ERROR_CODE_CLASSES,
} from "./errors.js";

export { f, validateFilter, FilterGrammarError } from "./filters.js";
export type {
  FilterNode,
  FilterInput,
  FilterLeaf,
  FilterAnd,
  FilterOr,
  FilterNot,
  FilterOp,
  FilterScalar,
  AnswerFilterField,
  TrafficFilterField,
  CitationFilterField,
} from "./filters.js";

export { Page, PagePromise, serializeWithCursor, type PageInfo } from "./core/pagination.js";
export type { RetryInfo } from "./core/retry.js";
export type { FetchLike, RawResponse } from "./core/http.js";

export * from "./types.js";

// Deliberately no default export. Mixing named and default exports makes a
// CommonJS consumer reach for `require("rankraft").default`, which is a trap
// nobody expects from a client library.
