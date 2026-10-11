#!/usr/bin/env bash
# Post-restart acceptance for the five batches one restart certified (2026-10-11).
#
# Batches N (`2462d59`), O (`d405708`), Q (`1b18799`), R (`ee2e3b9`) and Q2 (`9edd119`) all changed
# `src/project-memory/`, and none of them has a triggerable online surface: their observable
# behaviour needs a real consolidation reply (a partial document, a lossy render, a truncation), so
# no session log can witness them on demand. The acceptance is therefore a chain, re-derived here:
#
#   1. the whole-tree load criterion (holder start after the last `src/` commit) plus per-batch
#      attribution, `lib/` cleanliness, the restart target and live plugin activation
#      -> `.agents/evidence/2026-10-11-pre-restart-readiness/check.mjs`, which exits 0 exactly when
#      the criterion is positive;
#   2. the loaded `lib/` is the committed one — identical to a fresh `tsc` compile except
#      `lib/client.js` (the esbuild bundle, not a tsc artifact)
#      -> `.agents/evidence/2026-10-07-handoff-title-load-verify/verify.sh`;
#   3. a behavioural witness that the new holder really executes this repo's `lib/`: a handoff
#      continuation receives its second `session/title` after its own first human input
#      -> `.agents/evidence/2026-10-07-handoff-retitle-accept/retitle-accept.mjs` (exit 2 =
#      unobservable, never a failure);
#   4. the behaviour the loaded code was probed for — the Q2 guard probe and the memory-share fit
#      probe both `exit 0` against that same `lib/`.
#
# What this does NOT witness is stated in README.md: checks 1-4 prove the memory write path is
# loaded and behaves as probed, not that it has been exercised in the running host.
#
# Run:  bash .agents/evidence/2026-10-11-post-restart-five-batch-accept/verify.sh
# Exit: 0 = every check passed; 1 = at least one failed.
#
# The failure path is reachable and exercised: `CHECK_ARGS='--port 19999' bash verify.sh` makes
# check.mjs exit 2 (indeterminate), which is this script's NEGATIVE control.

set -uo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$root" || exit 1
if [ ! -f package.json ] || [ ! -d src/project-memory ]; then
	printf 'not the repo root: %s\n' "$root" >&2
	exit 1
fi

fail=0
ok() { printf '  PASS  %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

printf '== 1. load criterion, per-batch attribution, lib/, store, activation ==\n'
node .agents/evidence/2026-10-11-pre-restart-readiness/check.mjs ${CHECK_ARGS:-}
c=$?
if [ "$c" -eq 0 ]; then ok "check.mjs exit 0 (criterion positive, lib/ clean, plugin active)"
else bad "check.mjs exit $c (1 = not loaded, 2 = indeterminate)"; fi

printf '\n== 2. the loaded lib/ is the committed one ==\n'
bash .agents/evidence/2026-10-07-handoff-title-load-verify/verify.sh
c=$?
if [ "$c" -eq 0 ]; then ok "title-load verify exit 0 (criterion + fresh-compile identity)"; else bad "title-load verify failed"; fi

printf '\n== 3. behavioural witness: the new holder executes this lib ==\n'
node .agents/evidence/2026-10-07-handoff-retitle-accept/retitle-accept.mjs
c=$?
if [ "$c" -eq 0 ]; then ok "retitle-accept exit 0 (continuations re-titled after their own first input)"
elif [ "$c" -eq 2 ]; then printf '  NOTE  exit 2 = unobservable (no continuation typed into since the holder started)\n'
else bad "retitle-accept exit $c (1 = the deferred retitle is not live)"; fi

printf '\n== 4. the behaviour the loaded lib was probed for ==\n'
node .agents/evidence/2026-10-11-batchQ2-acceptance-guard/probe.mjs >/dev/null 2>&1
if [ $? -eq 0 ]; then ok "Q2 probe exit 0 (merge / refuse / report)"; else bad "Q2 probe failed"; fi
node .agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs >/dev/null 2>&1
if [ $? -eq 0 ]; then ok "share-fit exit 0 (no whole-entry loss, byte-identical round trip)"; else bad "share-fit failed"; fi

printf '\n%s\n' "$([ "$fail" -eq 0 ] && echo 'RESULT: PASS' || echo 'RESULT: FAIL')"
exit "$fail"
