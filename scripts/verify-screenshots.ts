import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Scenario } from "./config";
import { screenshotDimensions } from "./screenshots";
import type { ProjectResult } from "./test-report";

const evidence: Record<Scenario["kind"], string> = {
  "mbt-import": "import-verified",
  "rename-symbol": "rename-verified",
  "java-diagnostics": "imports-resolved",
  "java-test-discovery": "test-run-button-discovered",
  "java-main-run": "application-started",
  "java-debug-test": "debug-test-finished",
  "go-to-definition": "definition-verified",
  hover: "hover-verified",
};

export function verifyScreenshots(directory: string): number {
  const result = JSON.parse(readFileSync(resolve(directory, "result.json"), "utf8")) as ProjectResult;
  let count = 0;
  for (const scenario of result.scenarios) {
    if (scenario.status === "unknown") throw new Error(`${scenario.id}: scenario did not finish`);
    if (scenario.status === "skipped") continue;
    const folder = resolve(directory, "screenshots", scenario.id);
    const files = readdirSync(folder).filter((name) => name.endsWith(".png"));
    const step = scenario.status === "failed" ? "failure" : evidence[scenario.kind as Scenario["kind"]];
    if (!step || !files.some((name) => name.endsWith(`-${step}.png`))) {
      throw new Error(`${scenario.id}: missing screenshot for ${step ?? scenario.kind}`);
    }
    for (const file of files) {
      screenshotDimensions(readFileSync(resolve(folder, file)));
      count += 1;
    }
  }
  if (!count) throw new Error("No screenshots to verify");
  return count;
}

if (require.main === module) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: verify-screenshots <report directory>");
  console.log(`Verified ${verifyScreenshots(resolve(directory))} screenshots in ${directory}`);
}
