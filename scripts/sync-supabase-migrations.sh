#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/infra/supabase/migrations"
TARGET_DIR="$ROOT_DIR/supabase/migrations"

mkdir -p "$TARGET_DIR"

copied=0
skipped=0

while IFS= read -r -d '' src; do
  base="$(basename "$src")"
  # Skip hidden files like .gitkeep
  if [[ "$base" == .* ]]; then
    continue
  fi

  # If this logical migration was already synced, skip.
  if compgen -G "$TARGET_DIR/*_${base}" > /dev/null; then
    echo "skip  $base (already synced)"
    skipped=$((skipped + 1))
    continue
  fi

  stamp="$(date +%Y%m%d%H%M%S)"
  dest="$TARGET_DIR/${stamp}_${base}"
  cp "$src" "$dest"
  echo "copy  $base -> $(basename "$dest")"
  copied=$((copied + 1))
  sleep 1
done < <(find "$SOURCE_DIR" -maxdepth 1 -type f -name '*.sql' -print0 | sort -z)

echo
echo "sync complete: copied=$copied skipped=$skipped"
