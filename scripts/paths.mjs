import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const paths = {
  root,
  communityConfig: resolve(root, "community-build.json"),
  extensions: resolve(root, ".test-extensions"),
  generatedSettings: resolve(root, ".generated", "settings.json"),
  mocha: resolve(root, ".mocharc.js"),
  settingsBase: resolve(root, "settings.base.json"),
  storage: resolve(root, ".test-resources"),
  test: resolve(root, "out", "mbt-import.test.js"),
  vscodePreload: resolve(root, "scripts", "vscode-launch-resources.cjs"),
};
