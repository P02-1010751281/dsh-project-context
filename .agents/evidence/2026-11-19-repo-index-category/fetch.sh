#!/usr/bin/env bash
# Re-fetch the sources of this evidence pack. Writes sources/<owner>__<repo>.{README.md,meta.json}
# plus urls.tsv (slug<TAB>url actually used), so manifest.tsv can be rebuilt with SHA-256.
set -u
cd "$(dirname "$0")"
OUT=sources; mkdir -p "$OUT"; : > urls.tsv
while read -r slug; do
  [ -z "$slug" ] && continue
  safe=$(echo "$slug" | tr '/' '_' | sed 's/_/\_\_/')   # owner__repo
  meta=$(curl -sS -m 20 -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$slug")
  echo "$meta" > "$OUT/$safe.meta.json"
  branch=$(echo "$meta" | python3 -c "import json,sys;print((json.load(sys.stdin).get('default_branch') or 'main'))" 2>/dev/null || echo main)
  url="https://raw.githubusercontent.com/$slug/$branch/README.md"
  code=$(curl -sS -m 20 -o "$OUT/$safe.README.md" -w "%{http_code}" "$url")
  if [ "$code" != "200" ]; then
    url="https://raw.githubusercontent.com/$slug/main/README.md"
    code=$(curl -sS -m 20 -o "$OUT/$safe.README.md" -w "%{http_code}" "$url")
  fi
  printf "%s\t%s\t%s\n" "$slug" "$code" "$url" >> urls.tsv
  sleep 0.4
done < list.txt
