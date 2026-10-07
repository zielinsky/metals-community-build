import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceSelection } from "../scripts/editor-text";

test("navigation selects the case-sensitive symbol rather than a comment with different casing", () => {
  assert.deepEqual(sourceSelection("/** greeting provider */\r\npublic interface Greeting {}", "Greeting"), [2, 18]);
  assert.throws(() => sourceSelection("greeting", "Greeting"), /case-sensitive/);
});
