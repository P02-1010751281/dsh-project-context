#!/usr/bin/env bash
# Fetch raw evidence with provenance. Usage: fetch.sh list.tsv
# list.tsv columns: slug<TAB>url<TAB>ext
set -uo pipefail
E="$(cd "$(dirname "$0")" && pwd)"
LIST="${1:?list.tsv}"
mkdir -p "$E/sources" "$E/api"
while IFS=$'\t' read -r slug url ext; do
  [ -z "${slug:-}" ] && continue
  case "$slug" in \#*) continue;; esac
  out="$E/sources/$slug.$ext"
  tmp="$out.part"
  code=$(curl -sSL -m 45 -A 'Mozilla/5.0 (X11; Linux x86_64) research-evidence-fetch' \
      -H 'Accept-Language: en-US,en;q=0.9' -o "$tmp" -w '%{http_code}' "$url" 2>/dev/null || echo 000)
  bytes=$(wc -c < "$tmp" 2>/dev/null || echo 0)
  if [ "$code" = "200" ] && [ "$bytes" -gt 0 ]; then
    mv "$tmp" "$out"
    sha=$(sha256sum "$out" | cut -d' ' -f1)
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -Iseconds)" "$slug" "$code" "$bytes" "$sha" "$url" >> "$E/manifest.tsv"
    echo "OK   $slug ($bytes bytes)"
  else
    rm -f "$tmp"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -Iseconds)" "$slug" "$code" "$bytes" "-" "$url" >> "$E/failures.tsv"
    echo "FAIL $slug http=$code"
  fi
done < "$LIST"
