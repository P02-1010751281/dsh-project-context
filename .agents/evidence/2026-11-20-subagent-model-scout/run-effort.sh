#!/usr/bin/env bash
# Same smoke test, but with an extra `-c key=value` override appended.
# Usage: run-effort.sh <out.tsv> <c-arg> <model...>
set -uo pipefail

OUT="$1"
CARG="$2"
shift 2
MODELS=("$@")

WORKDIR=/mnt/Data/Projects/dsh-project-context
PROMPT="Reply with exactly: READY"
cd "$WORKDIR" || exit 1

for m in "${MODELS[@]}"; do
  slug=$(printf '%s' "$m" | tr '/' '_')
  log="$(dirname "$OUT")/logs/high-${slug}.log"
  start=$(date +%s.%N)
  timeout 150 codex exec --sandbox read-only -C "$WORKDIR" -m "$m" -c "$CARG" "$PROMPT" </dev/null >"$log" 2>&1
  rc=$?
  end=$(date +%s.%N)
  secs=$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.1f", b-a}')
  ready=no; grep -qx 'READY' "$log" && ready=yes
  effort=$(grep -m1 '^reasoning effort:' "$log" | sed 's/^reasoning effort: //')
  tokens=$(grep -A1 '^tokens used$' "$log" | tail -1 | tr -d ' ,')
  errline=$(grep -m1 -iE '^ERROR|error:|invalid|unsupported' "$log" | head -c 240)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$m" "$rc" "$ready" "$secs" "${effort:-?}" "${tokens:-?}" "${errline:-}" >>"$OUT"
  echo "[$m +high] rc=$rc READY=$ready ${secs}s effort=${effort:-?} tokens=${tokens:-?} ${errline:-}"
done
