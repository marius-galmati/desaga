import { type ChildProcess, spawn } from "node:child_process";
import { defineConfig } from "tsup";

// Workspace packages are consumed as TS source (just-in-time packages): tsup
// bundles them into the app; npm dependencies stay external and are resolved
// from node_modules at runtime. emitDecoratorMetadata in tsconfig makes tsup
// transpile via SWC, which Nest DI requires.
//
// Dev relaunch lives here as a function (not a --onSuccess shell string):
// Windows cmd mangles quoted `--onSuccess "node --env-file=..."` commands, and
// spawning with an args array avoids shell parsing entirely.
let devChild: ChildProcess | undefined;

export default defineConfig((options) => ({
  entry: { main: "src/main.ts", "main.worker": "src/main.worker.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [/^@boca\//],
  // Conditional spread instead of `onSuccess: ... : undefined` — tsup's Options
  // type rejects an explicit undefined under exactOptionalPropertyTypes.
  ...(options.watch
    ? {
        onSuccess: async () => {
          devChild?.kill();
          devChild = spawn(process.execPath, ["--env-file-if-exists=../../.env", "dist/main.js"], {
            stdio: "inherit",
          });
          return () => {
            devChild?.kill();
            devChild = undefined;
          };
        },
      }
    : {}),
}));
