#!/usr/bin/env bash
# Typecheck this repo's host half and client half against ANOTHER dsh source tree's shipped .d.ts.
# Usage:
#   ./run-probe.sh <dsh-desktop-store-path> [workdir]
# Example (the candidate line):
#   ./run-probe.sh /nix/store/gqyc0zm2x5fk5kcyfs43x0gwzhsnbh0f-dsh-desktop-0.2.0-rc.2
# The store path is an ARGUMENT on purpose: hashes rotate on every rebuild, so a recorded path
# goes dead. Find one with: ls -d /nix/store/*-dsh-desktop-<version>
#
# Protocol: ALWAYS run the probe against a tree whose version matches what is actually running
# first. If that control is not green, the probe is broken (module identity, stale types) and the
# candidate result means nothing. Both halves must print "exit=0 errors=0".
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
ARTIFACT="${1:?usage: run-probe.sh <dsh-desktop-store-path> [workdir]}"
WORK="${2:-/tmp/dsh-api-probe}"
SRC="$ARTIFACT/lib/dsh-desktop/repo"
HOST_SPEC='@deepseek-ai/cordis,@deepseek-ai/dsh-agent,@deepseek-ai/dsh-commands,@deepseek-ai/dsh-llm,@deepseek-ai/dsh-session,@deepseek-ai/schemastery'
CLIENT_SPEC='@deepseek-ai/cordis,@deepseek-ai/dsh-client-locale/client,@deepseek-ai/dsh-client-store,@deepseek-ai/dsh-client-ui-plugin-manager/client,@deepseek-ai/dsh-client-ui-primitives,@deepseek-ai/dsh-client-ui-renderer/client,@deepseek-ai/dsh-client-ui-settings/client,@deepseek-ai/dsh-client-ui-slots'

[ -d "$SRC/packages" ] || { echo "no source repo at $SRC/packages" >&2; exit 2; }
mkdir -p "$WORK"
TSC="$REPO/node_modules/.bin/tsc"
[ -x "$TSC" ] || { echo "no tsc at $TSC (run pnpm install in $REPO)" >&2; exit 2; }

run_half() { # name, generator, spec, config
  local name="$1" gen="$2" spec="$3" conf="$WORK/tsconfig.$1.json"
  echo "=== $name vs $(basename "$ARTIFACT") ==="
  node "$gen" "$spec" "$SRC" "$conf" || return 1
  local out="$WORK/$name.log"
  "$TSC" -p "$conf" > "$out" 2>&1 && rc=0 || rc=$?
  echo "exit=$rc errors=$(grep -c 'error TS' "$out" || true)"
  [ "$rc" -eq 0 ] || head -20 "$out"
  return "$rc"
}

run_half host     "$(dirname "$0")/mk-probe.mjs"        "$HOST_SPEC"   || exit 1
run_half client   "$(dirname "$0")/mk-client-probe.mjs" "$CLIENT_SPEC" || exit 1
echo "both halves clean against $(basename "$ARTIFACT")"
