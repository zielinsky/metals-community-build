import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { paths } from "./paths";

export function prepareSmokeWorkspace(workspace: string): void {
  // Keep the checked-in fixture pristine, including when rename/debug fails.
  mkdirSync(workspace, { recursive: true });
  cpSync(resolve(paths.root, "fixtures", "smoke"), workspace, { recursive: true });
  // MBT reads the Git index. An untracked fixture inherits workspaces/ ignores
  // from its parent repository and has no indexed sources.
  for (const args of [
    ["init", "--quiet", workspace],
    ["-C", workspace, "add", "--", ".gitignore", "pom.xml", "src"],
  ]) {
    const result = spawnSync("git", args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`git ${args[0]} failed (${result.status})`);
  }
}

if (require.main === module) {
  const workspace = resolve(paths.root, "workspaces", "smoke");
  prepareSmokeWorkspace(workspace);
  const result = spawnSync(process.execPath, [
    resolve(__dirname, "run-local.js"),
    "--project", "fixtures/smoke.json", "--workspace", workspace,
    ...process.argv.slice(2),
  ], { cwd: paths.root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
