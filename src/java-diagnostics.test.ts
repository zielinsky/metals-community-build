import assert from "node:assert/strict";
import { basename } from "node:path";

import {
  BottomBarPanel,
  MarkerType,
  TextEditor,
} from "vscode-extension-tester";

import type { JavaDiagnosticsScenario } from "../scripts/config";
import {
  captureScreenshot,
  delay,
  fileFor,
  log,
  prepareMbt,
} from "./test-support";

async function assertNoFileErrors(openFile: string): Promise<void> {
  const panel = new BottomBarPanel();
  try {
    const problems = await panel.openProblemsView();
    await problems.setFilter(basename(openFile));
    await delay(500);

    const files = await problems.getAllVisibleMarkers(MarkerType.File);
    for (const file of files) await file.toggleExpand(true);
    await delay(500);

    const errors = await problems.getAllVisibleMarkers(MarkerType.Error);
    const messages = await Promise.all(errors.map((error) => error.getText()));
    assert.deepEqual(
      messages,
      [],
      `Expected no errors in ${basename(openFile)}, found:\n${messages.join("\n")}`,
    );
    log(`Verified that ${basename(openFile)} has no error diagnostics`);
    await captureScreenshot("imports-resolved");
  } finally {
    await panel.closePanel().catch(() => undefined);
  }
}

export async function testJavaDiagnostics(
  scenario: JavaDiagnosticsScenario,
): Promise<void> {
  await prepareMbt(scenario);

  const editor = new TextEditor();
  const source = await editor.getText();
  for (const importedType of scenario.imports) {
    assert.ok(
      source.includes(`import ${importedType};`),
      `Missing expected import: ${importedType}`,
    );
  }

  await editor.selectText(`import ${scenario.imports[0]};`);
  await delay(5_000);
  await assertNoFileErrors(fileFor(scenario));
  log(`Scenario passed: ${scenario.id}`);
}
