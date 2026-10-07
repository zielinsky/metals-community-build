import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");

export const paths = {
  root,
  communityConfig: resolve(root, "community-build.json"),
  extensions: resolve(root, ".test-extensions"),
  generatedSettings: resolve(root, ".generated", "settings.json"),
  mocha: resolve(root, ".mocharc.json"),
  // Checkout of the `projects` branch (CI) or a worktree of it (local).
  projects: resolve(root, "projects"),
  settingsBase: resolve(root, "settings.base.json"),
  storage: resolve(root, ".test-resources"),
  tests: resolve(root, "out", "src", "community-build.test.js"),
  vscodePreload: resolve(root, "out", "scripts", "vscode-launch-resources.js"),
};
