import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { paths } from "./paths";

const executable = resolve(
  paths.root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "extest.cmd" : "extest",
);

export function runExtester(
  args: string[],
  env: Record<string, string> = {},
): number {
  const result = spawnSync(executable, args, {
    cwd: paths.root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
