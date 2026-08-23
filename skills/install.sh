#!/usr/bin/env bash
# Link every skill in this repo into each agent's global skill directory.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGETS=(
  "$HOME/.claude/skills"          # Claude Code
  "$HOME/.codex/skills"           # Codex
  "$HOME/.config/opencode/skills" # OpenCode
)

for skill in "$SRC"/*/; do
  name="$(basename "$skill")"
  [ -f "$skill/SKILL.md" ] || continue
  for target in "${TARGETS[@]}"; do
    mkdir -p "$target"
    link="$target/$name"
    if [ -L "$link" ] || [ ! -e "$link" ]; then
      ln -sfn "$skill" "$link"
      echo "linked $link"
    else
      echo "skip (real dir exists): $link" >&2
    fi
  done
done
