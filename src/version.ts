/**
 * Kept in step with package.json by scripts/check-version.mjs, which the
 * release workflow runs before it publishes. The same fact living in two files
 * is only safe when something asserts they agree.
 */
export const VERSION = "0.1.0";

/** The spec version this client was written against. Sent in the User-Agent. */
export const SPEC_VERSION = "1.0.0";
