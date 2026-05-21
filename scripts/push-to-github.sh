#!/usr/bin/env bash
# Ubuntu 3.0 — one-shot helper to wire this repo up to a private GitHub remote.
#
# Prerequisites:
#   1. A GitHub account.
#   2. SSH access set up (test with: ssh -T git@github.com)
#   3. A NEW empty private repo on github.com — DO NOT initialise it with a
#      README/license/.gitignore. Copy the SSH URL, it looks like:
#        git@github.com:academie-ubuntu/ubuntu3.git
#
# Run from the project root:
#   bash scripts/push-to-github.sh git@github.com:academie-ubuntu/ubuntu3.git
set -euo pipefail

if [ "${1-}" = "" ]; then
  echo "Usage: bash scripts/push-to-github.sh <ssh-url>"
  echo "Example:  bash scripts/push-to-github.sh git@github.com:academie-ubuntu/ubuntu3.git"
  exit 1
fi

REMOTE_URL="$1"

cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  echo "✗ This isn't a git repo. Run 'git init' first." >&2
  exit 1
fi

# Stash uncommitted changes (if any) so the push is from a clean state.
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ You have uncommitted changes:" >&2
  git status --short >&2
  echo "  Commit them first (or 'git stash'), then re-run this script." >&2
  exit 1
fi

# Wire the remote.
if git remote get-url origin >/dev/null 2>&1; then
  CUR=$(git remote get-url origin)
  if [ "$CUR" = "$REMOTE_URL" ]; then
    echo "✓ Remote 'origin' already set to $REMOTE_URL"
  else
    echo "✗ Remote 'origin' is already set to a different URL:"
    echo "    current: $CUR"
    echo "    wanted:  $REMOTE_URL"
    echo "  Update it manually with: git remote set-url origin $REMOTE_URL"
    exit 1
  fi
else
  echo "→ Adding remote 'origin' = $REMOTE_URL"
  git remote add origin "$REMOTE_URL"
fi

echo "→ Pushing main"
git push -u origin main

# Push develop if it exists.
if git show-ref --verify --quiet refs/heads/develop; then
  echo "→ Pushing develop"
  git push -u origin develop
fi

echo "→ Pushing tags (v0.3.6, ...)"
git push --tags

echo ""
echo "✓ All done. Your repo is now backed up on GitHub."
echo "  Future workflow:"
echo "    git push          # push the current branch"
echo "    git push --tags   # push new release tags"
