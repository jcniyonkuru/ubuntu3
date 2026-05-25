#!/usr/bin/env bash
# Install the project's git hooks into .git/hooks. Run once per clone.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

mkdir -p .git/hooks
for hook in scripts/hooks/*; do
  name=$(basename "$hook")
  target=".git/hooks/$name"
  ln -sf "../../$hook" "$target"
  echo "✓ installed $name → $target"
done
echo
echo "Verify the pre-commit guard by running:"
echo "    .git/hooks/pre-commit && echo ok"
