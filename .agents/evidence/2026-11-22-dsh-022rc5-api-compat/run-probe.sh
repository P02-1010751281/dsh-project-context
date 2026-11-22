#!/usr/bin/env bash
# Typecheck both halves of this repo against an arbitrary dsh-desktop store tree, then prove the
# probe really read that tree (resolution trace) and can go red (sensitivity control).
#
# Usage:  ./run-probe.sh <dsh-desktop-store-path> [workdir]
# Find a tree:  ls -d /nix/store/*-dsh-desktop-<version>
#
# Why this exists next to ../../2026-10-03-dsh-020rc2-api-compat/run-probe.sh: that script's HOST_SPEC
# mapped six packages, but `src/host/contract.ts` also imports `@deepseek-ai/dsh-session-projection`
# and `@deepseek-ai/dsh-token-meter` directly, so those two resolved from this repo's node_modules
# (the pinned floor) instead of the candidate tree — a silent hole in a probe whose whole point is the
# candidate's type surface. This wrapper maps every direct import (and the client packages' transitive
# dsh deps) and reports the store-vs-node_modules split instead of assuming it.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
ARTIFACT="${1:?usage: run-probe.sh <dsh-desktop-store-path> [workdir]}"
WORK="${2:-/tmp/dsh-api-probe}"
SRC="$ARTIFACT/lib/dsh-desktop/repo"
GEN="$(cd "$(dirname "$0")/../2026-10-03-dsh-020rc2-api-compat" && pwd)"

# Every @deepseek-ai module the host half imports directly, plus schemastery (a real runtime dep).
HOST_SPEC='@deepseek-ai/cordis,@deepseek-ai/dsh-agent,@deepseek-ai/dsh-commands,@deepseek-ai/dsh-llm,@deepseek-ai/dsh-session,@deepseek-ai/dsh-session-projection,@deepseek-ai/dsh-token-meter,@deepseek-ai/schemastery'
# The eight client packages we mount into, plus the dsh packages their declarations pull in: without
# the latter, ui-primitives' own imports resolve from our node_modules and the client half quietly
# compiles against the old line.
CLIENT_SPEC='@deepseek-ai/cordis,@deepseek-ai/dsh-agent,@deepseek-ai/dsh-attachment,@deepseek-ai/dsh-brand,@deepseek-ai/dsh-client-locale/client,@deepseek-ai/dsh-client-store,@deepseek-ai/dsh-client-ui-plugin-manager/client,@deepseek-ai/dsh-client-ui-primitives,@deepseek-ai/dsh-client-ui-renderer/client,@deepseek-ai/dsh-client-ui-settings/client,@deepseek-ai/dsh-client-ui-slots,@deepseek-ai/dsh-commands,@deepseek-ai/dsh-llm,@deepseek-ai/dsh-session,@deepseek-ai/dsh-session-projection,@deepseek-ai/dsh-system-prompt,@deepseek-ai/dsh-token-meter,@deepseek-ai/dsh-typert-protocol,@deepseek-ai/dsh-util-values,@deepseek-ai/schemastery,@deepseek-ai/cosmokit'

[ -d "$SRC/packages" ] || { echo "no source repo at $SRC/packages" >&2; exit 2; }
mkdir -p "$WORK"
TSC="$REPO/node_modules/.bin/tsc"
[ -x "$TSC" ] || { echo "no tsc at $TSC (run pnpm install in $REPO)" >&2; exit 2; }

count_split() { # trace log
	node -e '
const fs = require("node:fs");
const [trace, store, repo] = process.argv.slice(1);
const text = fs.readFileSync(trace, "utf8");
const hits = [...text.matchAll(/Module name .([^.\x27]+).\ was successfully resolved to .([^\x27]+)./g)]
  .filter((m) => m[1].startsWith("@deepseek-ai/") || m[1] === "schemastery");
const fromStore = hits.filter((m) => m[2].startsWith(store)).length;
const fromRepo = hits.filter((m) => m[2].startsWith(repo + "/node_modules")).length;
console.log(`  resolutions=${hits.length} store=${fromStore} repo-node_modules=${fromRepo}`);
if (fromRepo !== 0) process.exitCode = 1;
' "$1" "$SRC" "$REPO"
}

probe_half() { # name, generator, spec
	local name="$1" gen="$2" spec="$3" conf="$WORK/tsconfig.$1.json"
	echo "=== $name vs $(basename "$ARTIFACT") ==="
	node "$GEN/$gen" "$spec" "$SRC" "$conf"
	local out="$WORK/$name.log"
	local rc=0
	"$TSC" -p "$conf" > "$out" 2>&1 || rc=$?
	echo "  exit=$rc errors=$(grep -c 'error TS' "$out" || true)"
	[ "$rc" -eq 0 ] || head -20 "$out"
	"$TSC" -p "$conf" --traceResolution > "$WORK/$name.trace.log" 2>&1 || true
	count_split "$WORK/$name.trace.log" || echo "  LEAK: some dsh modules resolved from this repo's node_modules"
	[ "$rc" -eq 0 ]
}

probe_half host mk-probe.mjs "$HOST_SPEC"
probe_half client mk-client-probe.mjs "$CLIENT_SPEC"

# Sensitivity: a green compile is evidence only if the same config can be made red. Point the session
# package at dsh-llm's declarations and require a non-zero exit with real errors.
echo "=== sensitivity control (session -> llm declarations) ==="
node -e '
const fs = require("node:fs");
const [cfgPath, outPath] = process.argv.slice(1);
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const paths = cfg.compilerOptions.paths;
paths["@deepseek-ai/dsh-session"] = paths["@deepseek-ai/dsh-llm"];
fs.writeFileSync(outPath, JSON.stringify(cfg, null, 2));
' "$WORK/tsconfig.host.json" "$WORK/tsconfig.host.red.json"
rc=0
"$TSC" -p "$WORK/tsconfig.host.red.json" > "$WORK/sensitivity-red.log" 2>&1 || rc=$?
errors=$(grep -c "error TS" "$WORK/sensitivity-red.log" || true)
echo "  exit=$rc errors=$errors (expected: non-zero and > 0)"
[ "$rc" -ne 0 ] && [ "$errors" -gt 0 ] || { echo "  LEAK: the probe cannot go red" >&2; exit 1; }
echo "both halves clean against $(basename "$ARTIFACT"); probe is sensitive"
