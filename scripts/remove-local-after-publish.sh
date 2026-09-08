#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(basename "$ROOT_DIR")" == "QWEN" ]] || { echo "Refusing: unexpected project path $ROOT_DIR"; exit 1; }

echo "This permanently removes the local Qwen project, model, builds, packages, and database:"
echo "  $ROOT_DIR"
read -r -p 'Type DELETE QWEN LOCAL to continue: ' confirmation
[[ "$confirmation" == "DELETE QWEN LOCAL" ]] || { echo 'Cancelled.'; exit 0; }

cd /tmp
rm -rf -- "$ROOT_DIR"
echo "Removed $ROOT_DIR"
