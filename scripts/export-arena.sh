#!/usr/bin/env bash
# Export an arena .blend → public/assets/arenas/<name>.glb
#
# Usage:
#   scripts/export-arena.sh default                  # default_arena.blend → default.glb
#   scripts/export-arena.sh temple                   # temple.blend       → temple.glb
#   scripts/export-arena.sh foo /path/to/foo.blend   # custom source path → foo.glb
#
# Env:
#   BLENDER   path to Blender binary (default: /opt/homebrew/bin/blender)

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <arena-id> [blend-path]" >&2
  exit 1
fi

ID="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLENDER="${BLENDER:-/opt/homebrew/bin/blender}"

# Default source name: <id>.blend, with `default` mapping to `default_arena.blend`.
if [[ $# -ge 2 ]]; then
  BLEND="$2"
elif [[ "$ID" == "default" ]]; then
  BLEND="$ROOT/assets/source/default_arena.blend"
else
  BLEND="$ROOT/assets/source/${ID}.blend"
fi

OUT="$ROOT/public/assets/arenas/${ID}.glb"

if [[ ! -x "$BLENDER" ]]; then
  echo "ERROR: blender not found at $BLENDER (set BLENDER=...)" >&2
  exit 1
fi

ARENA_BLEND="$BLEND" ARENA_OUT="$OUT" \
  "$BLENDER" -b -P "$ROOT/scripts/export_arena.py"
