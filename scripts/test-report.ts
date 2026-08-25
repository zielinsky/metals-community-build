import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ProjectConfig, Scenario } from "./config";

export type ScenarioStatus = "passed" | "failed" | "unknown";

export interface ScenarioResult {
  id: string;
  kind: string;
  status: ScenarioStatus;
  durationMs?: number;
}

export interface ProjectResult {
  project: string;
  projectName: string;
  buildTool: string;
  repository: string;
  ref: string;
  status: ScenarioStatus;
  scenarios: ScenarioResult[];
}

export function createProjectResult(
  project: ProjectConfig,
  scenarios: Scenario[],
): ProjectResult {
  return {
    project: project.id,
    projectName: project.name,
    buildTool: project.buildTool,
    repository: project.repository,
    ref: project.ref,
    status: "unknown",
    scenarios: scenarios.map(({ id, kind }) => ({
      id,
      kind,
      status: "unknown",
    })),
  };
}

export function updateScenarioResult(
  result: ProjectResult,
  scenario: Scenario,
  status: Exclude<ScenarioStatus, "unknown">,
  durationMs: number,
): void {
  const entry = result.scenarios.find(({ id }) => id === scenario.id);
  if (!entry) throw new Error(`Missing report entry for '${scenario.id}'`);
  entry.status = status;
  entry.durationMs = durationMs;

  result.status = result.scenarios.some(({ status }) => status === "failed")
    ? "failed"
    : result.scenarios.every(({ status }) => status === "passed")
      ? "passed"
      : "unknown";
}

export function writeProjectResult(
  reportDirectory: string | undefined,
  result: ProjectResult,
): void {
  if (!reportDirectory) return;
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(
    resolve(reportDirectory, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}
