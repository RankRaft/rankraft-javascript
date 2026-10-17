#!/usr/bin/env node
/**
 * One version, four places, asserted to agree — and, with a tag argument, to
 * agree with the tag as well. Modelled on the WordPress plugin's own
 * check-version.mjs, which exists for the same reason: the same fact in
 * several files is only safe when something fails loudly when they diverge.
 *
 * Prints the bare version on success, which the release workflow captures.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const pkg = JSON.parse(read("../package.json")).version;
const src = read("../src/version.ts").match(/export const VERSION = "([^"]+)"/)?.[1];
const readme = read("../README.md").match(/rankraft@(\d+\.\d+\.\d+)/)?.[1] ?? pkg;

const sources = { "package.json": pkg, "src/version.ts": src, "README.md": readme };

const tag = process.argv[2];
if (tag) {
  const m = /^v(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(tag);
  if (!m) {
    console.error(`check-version: tag "${tag}" is not vX.Y.Z`);
    process.exit(1);
  }
  sources["git tag"] = m[1];
}

const distinct = new Set(Object.values(sources));
if (distinct.size !== 1 || distinct.has(undefined)) {
  const width = Math.max(...Object.keys(sources).map((k) => k.length));
  console.error("check-version: these do not agree\n");
  for (const [name, value] of Object.entries(sources)) {
    console.error(`  ${name.padEnd(width)}  ${value ?? "(not found)"}`);
  }
  process.exit(1);
}
console.log(pkg);
