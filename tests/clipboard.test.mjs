import assert from "node:assert/strict";
import test from "node:test";
import { clipboardImageFiles } from "../.test-build/clipboard.js";

test("reads clipboard images from files and items without duplicates", () => {
  const png = { name: "screenshot.png", size: 42, type: "image/png" };
  const text = { name: "note.txt", size: 5, type: "text/plain" };
  const data = {
    files: [png, text],
    items: [
      { type: "image/png", getAsFile: () => png },
      { type: "image/jpeg", getAsFile: () => null },
    ],
  };
  assert.deepEqual(clipboardImageFiles(data), [png]);
});
