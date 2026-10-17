import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERROR_CODE_CLASSES, OPERATIONS } from "../src/index.js";

/**
 * The SDK against the published contract.
 *
 * This is the only thing standing between a hand-written client and silent
 * drift. It is what catches the failure mode that matters most - the API grows
 * an endpoint and nobody here ever learns.
 *
 * `spec/openapi.json` is vendored by `pnpm spec:sync` and refreshed by a daily
 * workflow that opens a PR on any change. Until the API Worker ships there is
 * nothing to fetch, so this suite skips - loudly, never silently, which is the
 * same bargain the main repo strikes with its PHP suite when php is absent.
 */

const SPEC_PATH = fileURLToPath(new URL("../spec/openapi.json", import.meta.url));
const present = existsSync(SPEC_PATH);

if (!present) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n  ⚠ conformance: spec/openapi.json is missing, so the SDK was NOT checked\n" +
      "    against the API contract. Run `pnpm spec:sync` once api.rankraft.ai is live.\n",
  );
}

interface OpenApiDoc {
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, { properties?: { code?: { enum?: string[] } } }> };
}

const describeSpec = present ? describe : describe.skip;

describeSpec("conformance with openapi.json", () => {
  // describe.skip still evaluates this body, so the read must be guarded.
  const spec: OpenApiDoc = present ? (JSON.parse(readFileSync(SPEC_PATH, "utf8")) as OpenApiDoc) : {};

  // The Worker may mount routes with or without the /v1 prefix depending on
  // how the base path is declared; compare on the suffix either way.
  const norm = (p: string) => p.replace(/^\/v1/, "");

  const specOps = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (!["get", "post", "patch", "put", "delete"].includes(method)) continue;
      specOps.add(`${method.toUpperCase()} ${norm(path)}`);
    }
  }

  const sdkOps = new Set(Object.values(OPERATIONS).map((op) => `${op.method} ${norm(op.path)}`));

  it("models every endpoint the API publishes", () => {
    const missing = [...specOps].filter((o) => !sdkOps.has(o));
    expect(missing, `the API has endpoints this SDK does not model: ${missing.join(", ")}`).toEqual([]);
  });

  it("models no endpoint the API does not publish", () => {
    const extra = [...sdkOps].filter((o) => !specOps.has(o));
    expect(extra, `this SDK models endpoints the API does not publish: ${extra.join(", ")}`).toEqual([]);
  });

  it("knows every error code the API can return", () => {
    const schema = spec.components?.schemas?.["Error"] ?? spec.components?.schemas?.["ApiError"];
    const codes = schema?.properties?.code?.enum;
    if (!codes) return; // the spec does not enumerate them; nothing to compare
    const unknown = codes.filter((c) => !(c in ERROR_CODE_CLASSES));
    expect(unknown, `error codes with no mapped class: ${unknown.join(", ")}`).toEqual([]);
  });
});
