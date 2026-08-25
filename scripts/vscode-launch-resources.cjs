const chrome = require("selenium-webdriver/chrome");
const { pathToFileURL } = require("node:url");

const encodedResources = process.env.METALS_COMMUNITY_VSCODE_RESOURCES;
const resources = encodedResources ? JSON.parse(encodedResources) : {};
if (
  typeof resources.folder !== "string" ||
  typeof resources.file !== "string"
) {
  throw new Error(
    "METALS_COMMUNITY_VSCODE_RESOURCES must define string folder and file fields",
  );
}
const resourceArguments = [
  `--folder-uri=${pathToFileURL(resources.folder).href}`,
  `--file-uri=${pathToFileURL(resources.file).href}`,
];

const originalAddArguments = chrome.Options.prototype.addArguments;
let injected = false;
chrome.Options.prototype.addArguments = function (...args) {
  const launchesVSCode = args.includes("--skip-welcome");
  if (!injected && launchesVSCode) {
    injected = true;
    return originalAddArguments.call(this, ...args, ...resourceArguments);
  }
  return originalAddArguments.call(this, ...args);
};

// Do not pass this preload into ChromeDriver, VS Code, or the extension host.
delete process.env.NODE_OPTIONS;
delete process.env.METALS_COMMUNITY_VSCODE_RESOURCES;
