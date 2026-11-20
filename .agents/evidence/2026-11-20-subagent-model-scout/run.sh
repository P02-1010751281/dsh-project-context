#!/usr/bin/env bash
# Sequential smoke test of magpie catalog model ids against the codex CLI.
# READ-ONLY: writes only under this evidence directory.
set -uo pipefail

OUT="$1"          # tsv output path
shift
MODELS=("$@")

WORKDIR=/mnt/Data/Projects/dsh-project-context
PROMPT="Reply with exactly: READY"
cd "$WORKDIR" || exit 1

for m in "${MODELS[@]}"; do
  slug=$(printf '%s' "$m" | tr '/' '_')
  log="$(dirname "$OUT")/logs/base-${slug}.log"
  start=$(date +%s.%N)
  timeout 150 codex exec --sandbox read-only -C "$WORKDIR" -m "$m" "$PROMPT" </dev/null >"$log" 2>&1
  rc=$?
  end=$(date +%s.%N)
  secs=$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.1f", b-a}')
  ready=no; grep -qx 'READY' "$log" && ready=yes
  [ "$ready" = no ] && grep -qx 'READY' "$log" && ready=yes
  effort=$(grep -m1 '^reasoning effort:' "$log" | sed 's/^reasoning effort: //')
  tokens=$(grep -A1 '^tokens used$' "$log" | tail -1 | tr -d ' ,')
  errline=$(grep -m1 -iE 'stream error|error|failed|not found|400|404|unexpected|unsupported' "$log" | head -c 300)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$m" "$rc" "$ready" "$secs" "${effort:-?}" "${tokens:-?}" "${errline:-}" >>"$OUT"
  echo "[$m] rc=$rc READY=$ready ${secs}s effort=${effort:-?} tokens=${tokens:-?}"
done
