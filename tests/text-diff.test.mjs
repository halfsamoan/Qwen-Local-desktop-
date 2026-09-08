import test from "node:test";
import assert from "node:assert/strict";
import { buildLineDiff } from "../.test-build/textDiff.js";

test("buildLineDiff returns reviewable additions and removals", () => {
  assert.deepEqual(buildLineDiff("one\ntwo\n", "one\nthree\n"), [
    { kind: "context", text: "one" },
    { kind: "remove", text: "two" },
    { kind: "add", text: "three" },
    { kind: "context", text: "" },
  ]);
});
