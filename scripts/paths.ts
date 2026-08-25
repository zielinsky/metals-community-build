import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");

export const paths = {
  root,
  communityConfig: resolve(root, "community-build.json"),
  extensions: resolve(root, ".test-extensions"),
  generatedSettings: resolve(root, ".generated", "settings.json"),
  mocha: resolve(root, ".mocharc.json"),
  settingsBase: resolve(root, "settings.base.json"),
  storage: resolve(root, ".test-resources"),
  tests: resolve(root, "out", "src", "community-build.test.js"),
  vscodePreload: resolve(root, "out", "scripts", "vscode-launch-resources.js"),
};
