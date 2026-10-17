import { defineConfig } from "tsup";

/**
 * Dual ESM + CJS with real .d.ts for both.
 *
 * esbuild alone cannot emit declarations, which is why this package uses tsup
 * rather than the single inline esbuild call the main repo uses for its browser
 * snippet. Customers still run Node 18/20 services and CommonJS test harnesses;
 * an ESM-only client turns into support tickets inside someone else's build,
 * and dual publishing is cheap for a leaf package with no dependencies.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  treeshake: true,
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
});
