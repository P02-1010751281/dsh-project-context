#!/usr/bin/env bash
# Verify this evidence pack against manifest.tsv (ISO time, slug, http, bytes, sha256, url).
set -euo pipefail
cd "$(dirname "$0")"
fail=0; rows=0
while IFS=$'\t' read -r _ts slug _http bytes sha _url; do
  rows=$((rows + 1))
  case "$slug" in
    *-readme) file="sources/${slug%-readme}.README.md" ;;
    *-meta)   file="sources/${slug%-meta}.meta.json" ;;
    *) echo "FAIL unknown slug: $slug"; fail=1; continue ;;
  esac
  [[ -f "$file" ]] || { echo "FAIL missing: $file"; fail=1; continue; }
  [[ "$(stat -c%s "$file")" == "$bytes" ]] || { echo "FAIL bytes: $file"; fail=1; }
  [[ "$(sha256sum "$file" | cut -d' ' -f1)" == "$sha" ]] || { echo "FAIL sha256: $file"; fail=1; }
done <manifest.tsv
echo "checked $rows rows"
[[ "$fail" -eq 0 ]] && echo "OK: evidence pack matches manifest.tsv" || { echo "MISMATCH"; exit 1; }
