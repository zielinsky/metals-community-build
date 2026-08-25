import { loadCommunityConfig } from "./config.mjs";
import { runExtester } from "./extester.mjs";
import { paths } from "./paths.mjs";

const { vscode } = loadCommunityConfig();
const version = ["--storage", paths.storage, "--code_version", vscode.version];
const commands = [
  ["get-vscode", ...version],
  ["get-chromedriver", ...version],
  [
    "install-from-marketplace",
    "--storage",
    paths.storage,
    "--extensions_dir",
    paths.extensions,
    vscode.extension,
  ],
];

for (const command of commands) {
  const status = runExtester(command);
  if (status !== 0) process.exit(status);
}
