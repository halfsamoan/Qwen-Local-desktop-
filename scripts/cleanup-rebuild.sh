#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGETS=(
  "$ROOT_DIR/src-tauri/target"
  "$ROOT_DIR/.phase0"
  "$ROOT_DIR/dist"
  "$ROOT_DIR/node_modules"
)

echo "The following rebuildable artifacts will be deleted:"
for path in "${TARGETS[@]}"; do
  if [[ -e "$path" ]]; then
    du -sh "$path" 2>/dev/null || true
    echo "  $path"
  fi
done
echo "The model, source files, installed app packages, local database, and lockfiles are not touched."
read -r -p "Type DELETE to continue: " confirmation
[[ "$confirmation" == "DELETE" ]] || { echo "Cancelled."; exit 0; }

for path in "${TARGETS[@]}"; do
  [[ -e "$path" ]] && rm -rf -- "$path"
done
echo "Cleanup complete. Rebuild with: npm install && npm test && npx tauri build --debug --no-bundle"
