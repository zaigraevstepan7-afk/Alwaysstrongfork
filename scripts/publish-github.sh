#!/usr/bin/env bash
# Upload this prepared source tree using the user's local GitHub CLI login.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO=zaigraevstepan7-afk/Alwaysstrongfork
command -v gh >/dev/null || { echo 'Install GitHub CLI first: brew install gh' >&2; exit 1; }
gh auth status
gh auth setup-git
TASK_DIR=$(mktemp -d)
trap 'rm -rf "$TASK_DIR"' EXIT
gh repo clone "$REPO" "$TASK_DIR/repo" -- --branch main --single-branch
(
  cd "$ROOT"
  tar --exclude='./.git' --exclude='./build' --exclude='./out' \
      --exclude='*/target' --exclude='*/__pycache__' --exclude='*.pyc' -cf - .
) | tar -xf - -C "$TASK_DIR/repo"
cd "$TASK_DIR/repo"
git config user.name zaigraevstepan7-afk
git config user.email 232660160+zaigraevstepan7-afk@users.noreply.github.com
git add .
if git diff --cached --quiet; then
  echo 'Prepared sources already match main.'
  exit 0
fi
git commit -m 'Import AlwaysStrongFork Repair 1.3 sources and add validated Magisk build'
git push origin HEAD:main
echo "Uploaded. Workflow: https://github.com/$REPO/actions/workflows/build.yml"
