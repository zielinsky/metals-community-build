import { loadCommunityConfig } from "./config";
import { runExtester } from "./extester";
import { paths } from "./paths";

const { vscode } = loadCommunityConfig();
const version = ["--storage", paths.storage, "--code_version", vscode.version];
const commands: string[][] = [
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
