#!/usr/bin/env bash
# Verify this evidence pack against manifest.tsv (ISO time, slug, http, bytes, sha256, url).
# Exit 0 only when every row's file exists, matches its byte count and its full SHA-256.
set -euo pipefail
cd "$(dirname "$0")"

# manifest slug -> local filename (they intentionally differ: slugs are short and stable)
map_file() {
	case "$1" in
	aoci-code-readme) echo "aoci-code-README.md" ;;
	dsh-aoci-readme) echo "dsh-aoci-README.md" ;;
	volumes-spec-v1) echo "aoci-cognition-volumes-v1.txt" ;;
	org-repos) echo "org-repos.json" ;;
	releases) echo "releases.json" ;;
	arxiv-abs) echo "arxiv-2605.02421-abs.html" ;;
	arxiv-html) echo "arxiv-2605.02421.html" ;;
	arxiv-html-txt) echo "aoci-paper-2605.02421.txt" ;;
	*) return 1 ;;
	esac
}

fail=0
rows=0
while IFS=$'\t' read -r _ts slug _http bytes sha _url; do
	rows=$((rows + 1))
	file="$(map_file "$slug")" || { echo "FAIL unknown slug: $slug"; fail=1; continue; }
	[[ -f "$file" ]] || { echo "FAIL missing: $file"; fail=1; continue; }
	actual_bytes="$(stat -c%s "$file")"
	actual_sha="$(sha256sum "$file" | cut -d' ' -f1)"
	[[ "$actual_bytes" == "$bytes" ]] || { echo "FAIL bytes: $file ($actual_bytes != $bytes)"; fail=1; }
	[[ "$actual_sha" == "$sha" ]] || { echo "FAIL sha256: $file"; fail=1; }
done <manifest.tsv

echo "checked $rows rows"
[[ "$fail" -eq 0 ]] && echo "OK: evidence pack matches manifest.tsv" || { echo "MISMATCH"; exit 1; }
