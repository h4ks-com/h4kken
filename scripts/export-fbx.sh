#!/usr/bin/env bash
# Export a .blend's armature + mesh as Mixamo-compatible FBX for the build pipeline.
#
# Usage:
#   scripts/export-fbx.sh <input.blend> [output.fbx]
#
# Defaults to assets/source/mita.blend → assets/source/mita.fbx.
#
# Override blender path with $BLENDER (default: /opt/homebrew/bin/blender).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLENDER="${BLENDER:-/opt/homebrew/bin/blender}"

INPUT="${1:-$ROOT/assets/source/mita.blend}"
OUTPUT="${2:-${INPUT%.blend}.fbx}"

if [[ ! -f "$INPUT" ]]; then
  echo "ERROR: input blend not found: $INPUT" >&2
  exit 1
fi

INPUT_ABS="$(cd "$(dirname "$INPUT")" && pwd)/$(basename "$INPUT")"
OUTPUT_DIR="$(cd "$(dirname "$OUTPUT")" && pwd)"
OUTPUT_ABS="$OUTPUT_DIR/$(basename "$OUTPUT")"

echo "[export-fbx] $INPUT_ABS -> $OUTPUT_ABS"

"$BLENDER" -b --factory-startup "$INPUT_ABS" \
  -P "$ROOT/scripts/export_fbx.py" -- "$OUTPUT_ABS"

echo "[export-fbx] done: $OUTPUT_ABS"
