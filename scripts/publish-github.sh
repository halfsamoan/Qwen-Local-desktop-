#!/usr/bin/env bash
set -euo pipefail

REMOTE_URL="${1:-}"
[[ "$REMOTE_URL" == https://github.com/*/*.git || "$REMOTE_URL" == git@github.com:*/*.git ]] || {
  echo 'Usage: ./scripts/publish-github.sh https://github.com/USER/REPO.git'; exit 2;
}
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$REMOTE_URL" || git remote add origin "$REMOTE_URL"
git push -u origin main
