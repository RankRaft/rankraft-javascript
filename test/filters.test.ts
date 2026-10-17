import { describe, expect, it } from "vitest";
import { FilterGrammarError, f, validateFilter } from "../src/index.js";

describe("the filter builder", () => {
  it("emits field, op and value in that order and never re-sorts", () => {
    // Key order may be load-bearing for the server's body-hash cursor.
    expect(JSON.stringify(f.is("platform", "chatgpt"))).toBe('{"field":"platform","op":"is","value":"chatgpt"}');
  });

  it("builds the documented tree shape", () => {
    expect(f.and(f.in("platform", ["chatgpt"]), f.not(f.is("category", "Brand")))).toEqual({
      and: [
        { field: "platform", op: "in", value: ["chatgpt"] },
        { not: { field: "category", op: "is", value: "Brand" } },
      ],
    });
  });

  it("rejects malformed grammar", () => {
    expect(() => validateFilter({})).toThrow(FilterGrammarError);
    expect(() => validateFilter({ and: [] })).toThrow(FilterGrammarError);
    expect(() => validateFilter({ and: [{ field: "x", op: "is", value: "y" }], not: {} })).toThrow(FilterGrammarError);
    expect(() => validateFilter({ field: "x", op: "nope", value: "y" })).toThrow(FilterGrammarError);
    expect(() => validateFilter({ field: "x", op: "in", value: "not a list" })).toThrow(FilterGrammarError);
    expect(() => validateFilter({ field: "x", op: "is", value: ["a list"] })).toThrow(FilterGrammarError);
    expect(() => f.in("platform", [])).toThrow(FilterGrammarError);
  });

  it("says nothing about depth or list length", () => {
    // Those are server limits. Duplicating a limit here would put the same
    // number in two places, and this copy is the one that would go stale; the
    // 422 carries the real figure.
    const deep = f.not(f.not(f.not(f.not(f.is("platform", "chatgpt")))));
    expect(() => validateFilter(deep)).not.toThrow();
    expect(() => f.in("platform", Array.from({ length: 500 }, (_, i) => `p${i}`))).not.toThrow();
  });

  it("stringifies numbers and booleans, because the wire type is string", () => {
    // `verified` is a boolean column; people will write f.is("verified", true).
    expect(f.is("verified", true)).toEqual({ field: "verified", op: "is", value: "true" });
    expect(f.in("rank", [1, 2])).toEqual({ field: "rank", op: "in", value: ["1", "2"] });
    // A raw object gets no such help: it must already be what the server accepts.
    expect(() => validateFilter({ field: "verified", op: "is", value: true })).toThrow(FilterGrammarError);
  });

  it("accepts a raw object anywhere a built node goes", () => {
    expect(() => validateFilter({ or: [{ field: "path", op: "contains", value: "/blog" }] })).not.toThrow();
  });
});
