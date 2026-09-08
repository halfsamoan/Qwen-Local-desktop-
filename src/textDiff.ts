export type DiffLine = { kind: "context" | "add" | "remove"; text: string };

// ponytail: one-line lookahead keeps review predictable; use an LCS diff only if edits need smarter hunks.
export function buildLineDiff(before: string, after: string, maxLines = 4000): DiffLine[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const result: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while ((oldIndex < oldLines.length || newIndex < newLines.length) && result.length < maxLines) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      result.push({ kind: "context", text: oldLines[oldIndex] ?? "" });
      oldIndex += 1;
      newIndex += 1;
    } else if (oldLines[oldIndex + 1] === newLines[newIndex]) {
      result.push({ kind: "remove", text: oldLines[oldIndex] ?? "" });
      oldIndex += 1;
    } else {
      if (oldIndex < oldLines.length) result.push({ kind: "remove", text: oldLines[oldIndex] });
      if (newIndex < newLines.length && result.length < maxLines) result.push({ kind: "add", text: newLines[newIndex] });
      oldIndex += 1;
      newIndex += 1;
    }
  }
  if (oldIndex < oldLines.length || newIndex < newLines.length) result.push({ kind: "context", text: "… diff truncated …" });
  return result;
}
