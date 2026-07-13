import { defineConfig } from "tsup";

// Workspace packages are consumed as TS source (just-in-time packages): tsup
// bundles them into the app; npm dependencies stay external and are resolved
// from node_modules at runtime. emitDecoratorMetadata in tsconfig makes tsup
// transpile via SWC, which Nest DI requires.
export default defineConfig({
  entry: { main: "src/main.ts", "main.worker": "src/main.worker.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [/^@boca\//],
});
