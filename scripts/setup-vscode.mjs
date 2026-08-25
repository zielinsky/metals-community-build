import { resolve } from "node:path";

import { loadCommunityConfig, repositoryRoot } from "./config.mjs";
import { extest, run } from "./process.mjs";

const config = loadCommunityConfig();
const storage = resolve(repositoryRoot, ".test-resources");
const extensions = resolve(repositoryRoot, ".test-extensions");

const commands = [
  ["get-vscode", "--storage", storage, "--code_version", config.vscode.version],
  [
    "get-chromedriver",
    "--storage",
    storage,
    "--code_version",
    config.vscode.version,
  ],
  [
    "install-from-marketplace",
    "--storage",
    storage,
    "--extensions_dir",
    extensions,
    config.vscode.extension,
  ],
];

for (const args of commands) {
  const status = run(extest, args);
  if (status !== 0) process.exit(status);
}
