#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "error: migrations directory not found at $MIGRATIONS_DIR" >&2
  exit 1
fi

files=()
while IFS= read -r file; do
  files+=("$file")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name "*.sql" | sort)
if [[ "${#files[@]}" -eq 0 ]]; then
  echo "error: no SQL migration files found in $MIGRATIONS_DIR" >&2
  exit 1
fi

for file in "${files[@]}"; do
  base="$(basename "$file")"
  if [[ ! "$base" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
    echo "error: invalid migration filename format: $base" >&2
    echo "expected: <14-digit-timestamp>_<snake_case_name>.sql" >&2
    exit 1
  fi
done

if ! grep -Rqi "create table if not exists websites" "$MIGRATIONS_DIR"; then
  echo "error: expected websites table definition not found in migrations" >&2
  exit 1
fi

if ! grep -Rqi "create table if not exists analyses" "$MIGRATIONS_DIR"; then
  echo "error: expected analyses table definition not found in migrations" >&2
  exit 1
fi

if ! grep -Rqi "create or replace function public.save_analysis_version" "$MIGRATIONS_DIR"; then
  echo "error: expected save_analysis_version function migration not found" >&2
  exit 1
fi

echo "migration validation passed (${#files[@]} files)."
