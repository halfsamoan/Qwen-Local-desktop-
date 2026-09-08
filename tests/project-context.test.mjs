import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectContext, selectProjectContextPaths } from "../.test-build/projectContext.js";

const tree = [
  { path: "src", is_dir: true },
  { path: "install.sh", is_dir: false },
  { path: "pyproject.toml", is_dir: false },
  { path: "README.md", is_dir: false },
];

test("always identifies the active project and visible tree", () => {
  const context = buildProjectContext("wifi-viewer", "/workspace/wifi-viewer", tree);
  assert.match(context, /Name: wifi-viewer/);
  assert.match(context, /Root: \/workspace\/wifi-viewer/);
  assert.match(context, /- src\//);
});

test("prioritizes selected and explicit files without duplicates", () => {
  assert.deepEqual(
    selectProjectContextPaths("src/app.py", ["README.md", "src/app.py"], [{ path: "ignored.py" }], tree),
    ["src/app.py", "README.md"],
  );
});

test("falls back to representative project files when search has no hits", () => {
  assert.deepEqual(selectProjectContextPaths("", [], [], tree, 3), ["README.md", "pyproject.toml", "install.sh"]);
});
