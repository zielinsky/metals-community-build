const chrome = require("selenium-webdriver/chrome");
const { pathToFileURL } = require("node:url");

const resources = JSON.parse(
  process.env.METALS_COMMUNITY_VSCODE_RESOURCES ?? "null",
);
if (
  typeof resources?.folder !== "string" ||
  typeof resources?.file !== "string"
) {
  throw new Error(
    "METALS_COMMUNITY_VSCODE_RESOURCES must define string folder and file fields",
  );
}
const vscodeResources = [
  `--folder-uri=${pathToFileURL(resources.folder).href}`,
  `--file-uri=${pathToFileURL(resources.file).href}`,
];

const originalAddArguments = chrome.Options.prototype.addArguments;
let resourcesAdded = false;
chrome.Options.prototype.addArguments = function (...args) {
  const launchesVSCode = args.includes("--skip-welcome");
  if (!resourcesAdded && launchesVSCode) {
    resourcesAdded = true;
    return originalAddArguments.call(this, ...args, ...vscodeResources);
  }
  return originalAddArguments.call(this, ...args);
};

// Do not pass this preload into ChromeDriver, VS Code, or the extension host.
delete process.env.NODE_OPTIONS;
delete process.env.METALS_COMMUNITY_VSCODE_RESOURCES;
