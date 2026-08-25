import { existsSync, rmSync } from "node:fs";
import { parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function resetWorkspace(workspacePath) {
  const workspace = resolve(workspacePath);
  const root = parse(workspace).root;

  if (workspace === root || !existsSync(workspace)) {
    throw new Error(`Refusing to clean invalid workspace: ${workspace}`);
  }

  rmSync(resolve(workspace, ".metals"), { recursive: true, force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workspace = process.env.METALS_COMMUNITY_WORKSPACE;
  if (!workspace) throw new Error("METALS_COMMUNITY_WORKSPACE is not set");
  resetWorkspace(workspace);
}
