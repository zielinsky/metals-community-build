import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { repositoryRoot } from "./config.mjs";

export const extest = resolve(
  repositoryRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "extest.cmd" : "extest",
);

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
