/**
 * The filter tree, and a small builder for it.
 *
 * Raw objects are accepted everywhere a filter is - that is the escape hatch
 * when the API grows an operator before this client does, and it is what an
 * LLM driving an MCP server will produce. The builder exists for everyone else.
 *
 * It validates *grammar* and never *magnitude*. Depth, list length, limits and
 * date spans are the server's rules; duplicating them here would put the same
 * number in two places, and the copy here would be the one that went stale. A
 * caller who exceeds one gets a 422 carrying the real figure, which is both
 * correct and self-documenting.
 */

export type FilterOp = "is" | "not_is" | "in" | "not_in" | "contains" | "not_contains";

/**
 * On the wire a value is a string, or a list of strings. The builder also
 * takes numbers and booleans and stringifies them (`true` → "true"), because
 * `verified` is a boolean column and `F("verified").is(true)` is what people
 * will write; a raw object must already be strings, as the server requires.
 */
export type FilterScalar = string;
export type FilterInput = string | number | boolean;

/**
 * Open unions on purpose. A misspelling is a compile error, while a field or
 * engine shipped after this release still works - a pinned client must never
 * throw because the API added something.
 */
export type AnswerFilterField = "platform" | "prompt" | "category" | (string & {});
export type TrafficFilterField =
  | "bot_name"
  | "bot_provider"
  | "bot_type"
  | "verified"
  | "path"
  | "page_type"
  | "referral_source"
  | (string & {});
export type CitationFilterField = AnswerFilterField | "domain" | "owner" | "source_kind";

export interface FilterLeaf {
  field: string;
  op: FilterOp;
  value: FilterScalar | FilterScalar[];
}
export interface FilterAnd {
  and: FilterNode[];
}
export interface FilterOr {
  or: FilterNode[];
}
export interface FilterNot {
  not: FilterNode;
}
export type FilterNode = FilterLeaf | FilterAnd | FilterOr | FilterNot;

const SCALAR_OPS: ReadonlySet<string> = new Set(["is", "not_is", "contains", "not_contains"]);
const LIST_OPS: ReadonlySet<string> = new Set(["in", "not_in"]);

export class FilterGrammarError extends Error {
  constructor(message: string) {
    super(`rankraft: ${message}`);
    this.name = "FilterGrammarError";
  }
}

/** Grammar only. Throws on a malformed node; says nothing about size. */
export function validateFilter(node: unknown, path = "filter"): void {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw new FilterGrammarError(`${path} must be an object`);
  }
  const keys = Object.keys(node);
  const record = node as Record<string, unknown>;

  if ("and" in record || "or" in record) {
    const key = "and" in record ? "and" : "or";
    if (keys.length !== 1) throw new FilterGrammarError(`${path} must contain only "${key}"`);
    const children = record[key];
    if (!Array.isArray(children) || children.length === 0) {
      throw new FilterGrammarError(`${path}.${key} must be a non-empty array`);
    }
    children.forEach((child, i) => validateFilter(child, `${path}.${key}[${i}]`));
    return;
  }

  if ("not" in record) {
    if (keys.length !== 1) throw new FilterGrammarError(`${path} must contain only "not"`);
    validateFilter(record["not"], `${path}.not`);
    return;
  }

  const { field, op, value } = record as { field?: unknown; op?: unknown; value?: unknown };
  if (typeof field !== "string" || field === "") throw new FilterGrammarError(`${path}.field must be a non-empty string`);
  if (typeof op !== "string" || (!SCALAR_OPS.has(op) && !LIST_OPS.has(op))) {
    throw new FilterGrammarError(`${path}.op must be one of is, not_is, in, not_in, contains, not_contains`);
  }
  if (LIST_OPS.has(op)) {
    if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v !== "")) {
      throw new FilterGrammarError(`${path}.value must be a non-empty array of strings for "${op}"`);
    }
  } else if (typeof value !== "string" || value === "") {
    throw new FilterGrammarError(`${path}.value must be a non-empty string for "${op}"`);
  }
}

// Keys are emitted in a fixed {field, op, value} order and never re-sorted - // key order may be load-bearing for the server's cursor hash.
const leaf = (field: string, op: FilterOp, value: FilterScalar | FilterScalar[]): FilterLeaf => ({ field, op, value });
const str = (v: FilterInput): string => String(v);

export const f = {
  is: (field: string, value: FilterInput): FilterLeaf => leaf(field, "is", str(value)),
  not_is: (field: string, value: FilterInput): FilterLeaf => leaf(field, "not_is", str(value)),
  in: (field: string, values: FilterInput[]): FilterLeaf => {
    if (values.length === 0) throw new FilterGrammarError(`"in" on ${field} needs at least one value`);
    return leaf(field, "in", values.map(str));
  },
  not_in: (field: string, values: FilterInput[]): FilterLeaf => {
    if (values.length === 0) throw new FilterGrammarError(`"not_in" on ${field} needs at least one value`);
    return leaf(field, "not_in", values.map(str));
  },
  contains: (field: string, value: string): FilterLeaf => leaf(field, "contains", value),
  not_contains: (field: string, value: string): FilterLeaf => leaf(field, "not_contains", value),

  and: (...nodes: FilterNode[]): FilterAnd => {
    if (nodes.length === 0) throw new FilterGrammarError("and() needs at least one node");
    return { and: nodes };
  },
  or: (...nodes: FilterNode[]): FilterOr => {
    if (nodes.length === 0) throw new FilterGrammarError("or() needs at least one node");
    return { or: nodes };
  },
  not: (node: FilterNode): FilterNot => ({ not: node }),
} as const;
