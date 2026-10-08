import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceSelection } from "../scripts/editor-text";

test("navigation selects the case-sensitive symbol rather than a comment with different casing", () => {
  assert.deepEqual(sourceSelection("/** greeting provider */\r\npublic interface Greeting {}", "Greeting"), [2, 18]);
  assert.throws(() => sourceSelection("greeting", "Greeting"), /case-sensitive/);
});

test("an identifier matches only as a whole word", () => {
  const source = "import java.util.OptionalInt;\nOptional<String> value;";
  assert.deepEqual(sourceSelection(source, "Optional"), [2, 1]);
  assert.deepEqual(sourceSelection(source, "java.util.Optional"), [1, 8]);
  assert.throws(() => sourceSelection("OptionalInt", "Optional"), /not found/);
});

test("near selects the occurrence on the first line containing the context", () => {
  const source = [
    "import static java.util.Objects.requireNonNull;",
    "class Main {",
    "  int size = Objects.hash(1);",
    "  Object other = Objects.toString(size);",
    "}",
  ].join("\n");
  assert.deepEqual(sourceSelection(source, "Objects"), [1, 25]);
  assert.deepEqual(sourceSelection(source, "Objects", "size = Objects.hash"), [3, 14]);
  assert.deepEqual(sourceSelection(source, "Objects", "Objects.toString"), [4, 18]);
  assert.throws(() => sourceSelection(source, "Objects", "missing"), /Context 'missing' not found/);
  assert.throws(() => sourceSelection(source, "Objects", "}"), /after '}'/);
});
