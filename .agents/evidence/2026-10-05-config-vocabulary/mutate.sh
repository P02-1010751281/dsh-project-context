#!/usr/bin/env bash
# Reproduce batch H's mutation round (2026-10-05, config vocabulary).
#
# Every mutant is one small edit to `src/` that inverts one behaviour the batch claims to pin, and it
# only counts if it is VALID: `tsc` 0 errors, its marker reaches `lib/` after `pnpm build`, and it
# changes behaviour on a probe input. A red from a mutant that fails any leg is not evidence.
#
# This script restores `src/` and `client/` from a snapshot on every exit path and rebuilds, so it
# cannot leave an unrestored mutation behind (the repo's rule: restoring `src/` does not restore
# `lib/`, so a round always ends with a rebuild and 0 markers).
#
#   bash .agents/evidence/2026-10-05-config-vocabulary/mutate.sh m1|m2|m4|m5|m6
#
# Expected: the named scoped test turns red for that mutant, and the trap leaves the tree green. If a
# mutant fails validity leg (a) or (b) the script prints `INVALID MUTANT` and exits 1 instead of
# reporting a red, because that red would not be evidence.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SNAP="$(mktemp -d /tmp/h-mutate.XXXXXX)"
MUTANT="${1:-}"

node -v >/dev/null # the store path rotates; never record it

restore() {
	rm -rf "$REPO/src" "$REPO/client"
	cp -a "$SNAP/src" "$SNAP/client" "$REPO/"
	(cd "$REPO" && pnpm build >/dev/null 2>&1) || true
	echo "restored src/ + client/ from $SNAP and rebuilt"
	echo "markers left in lib/: $(grep -rn 'MUTANT H' "$REPO/lib" | wc -l)"
}
cp -a "$REPO/src" "$REPO/client" "$SNAP/"
trap restore EXIT

# `edit <file> <old> <new>` — python does one literal replacement and refuses when the anchor is absent
# or ambiguous. A sed that silently misses would report a SURVIVED round that never happened.
edit() {
	python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
if text.count(old) != 1:
    sys.exit(f"anchor missing or ambiguous in {path}: {old!r} ({text.count(old)} hits)")
open(path, "w", encoding="utf-8").write(text.replace(old, new))
PY
}

# `expect_red <test file> <label>` — the scoped test must report a non-zero fail count. The reporter
# prints `ℹ fail N`; parse it rather than grepping for a symbol, and treat a missing line as
# indeterminate instead of as a pass.
expect_red() {
	local file="$1" label="$2" out fails
	out="$(cd "$REPO" && node --test "$file" 2>&1 || true)"
	fails="$(sed -n 's/^ℹ fail \([0-9][0-9]*\).*/\1/p' <<<"$out" | tail -1)"
	if [ -z "$fails" ]; then
		echo "INDETERMINATE: no 'ℹ fail N' line for $file"
		printf '%s\n' "$out" | tail -20
		exit 1
	fi
	if [ "$fails" -eq 0 ]; then
		echo "SURVIVED: $label did not redden $file"
		exit 1
	fi
	echo "KILLED: $label reddens $file (fail $fails)"
}

case "$MUTANT" in
m1)
	# D2=(b)'s negation: give one retired name a compatibility term in the unknown-key check.
	edit "$REPO/src/shared/config.ts" \
		'if (!CONFIG_KEYS.has(key)) throw new Error(`dsh-project-context: unknown config key "${key}"`);' \
		'if (!CONFIG_KEYS.has(key) && key !== "handoffKeepTokens") throw new Error(`dsh-project-context: unknown config key "${key}"`); // MUTANT H1'
	;;
m2)
	# The write path drifts off the schema: `/handoff budget recent` writes the retired key.
	edit "$REPO/src/project-handoff/command.ts" \
		'return { patch: { handoffBudgetRecentTokens: tokens } };' \
		'return { patch: { handoffKeepTokens: tokens } }; // MUTANT H2'
	;;
m4)
	# The D4 prefix reverts for one branch: the memory status line names the layer twice.
	# The marker MUST be a *block* comment here: the anchor is the consequent of a ternary, so a `//`
	# swallows the `: ` branch and the mutant stops compiling (`TS1005: ':' expected.`) — an invalid
	# mutant whose red is not evidence. Found 2026-10-05 by re-running this script verbatim.
	edit "$REPO/src/project-memory/index.ts" \
		'? `Memory: ${memory.source}${capped}`' \
		'? `Project memory: ${memory.source}${capped}` /* MUTANT H4 */'
	;;
m5)
	# The memory pass reads a sibling's switch instead of its own: `autolearnEnabled` defaults to true,
	# so nothing in the memory tests notices except the switch's own negative (added by this review).
	edit "$REPO/src/project-memory/index.ts" \
		'		const current = effectivePluginConfig(entry);
		if (!current.memoryEnabled) return;
		pending.track(agent.session, consolidateProject(ctx, current, agent, { force: false, silent: false }));' \
		'		const current = effectivePluginConfig(entry);
		if (!current.autolearnEnabled) return; // MUTANT H5
		pending.track(agent.session, consolidateProject(ctx, current, agent, { force: false, silent: false }));'
	;;
m6)
	# A card union loses an option the schema still accepts: the count-based assertions in
	# `card-render.test.mjs` derive from the same table, so only the schema comparison notices.
	edit "$REPO/client/card-fields.ts" \
		'{ key: "handoffLang", kind: "union", options: ["auto", "zh", "en"] },' \
		'{ key: "handoffLang", kind: "union", options: ["auto", "zh"] }, // MUTANT H6'
	;;
*)
	echo "usage: bash $0 m1|m2|m4|m5|m6   (m3 is deliberately absent: it does not compile, see README.md)"
	exit 2
	;;
esac

cd "$REPO"
# Validity leg (a): 0 errors. This used to be `pnpm typecheck >/dev/null`, which hid the reason behind a
# bare `[ELIFECYCLE] Command failed with exit code 2` — that reads like an environment fault rather than
# an invalid mutant. An invalid mutant's red is not evidence, so say so and show the compiler's own line.
if ! tcOut="$(pnpm typecheck 2>&1)"; then
	echo "INVALID MUTANT: does not compile, so its red would not be evidence (validity leg (a))"
	printf '%s\n' "$tcOut" | tail -20
	exit 1
fi
pnpm build >/dev/null
# Validity leg (b): the marker must actually reach the build output, otherwise a red proves nothing.
markers="$(grep -rn 'MUTANT H' lib/ || true)"
if [ -z "$markers" ]; then
	echo "INVALID MUTANT: marker did not reach lib/ after the build (validity leg (b))"
	exit 1
fi
printf '%s\n' "$markers" | sed 's/^/marker in lib\/: /'

case "$MUTANT" in
m1) expect_red test/config-vocabulary.test.mjs "m1 (reintroduced compatibility term)" ;;
m2) expect_red test/config-vocabulary.test.mjs "m2 (write path emits a retired key)" ;;
m4) expect_red test/logic.test.mjs "m4 (one Memory: prefix reverted)" ;;
m5) expect_red test/top-level-gate.test.mjs "m5 (memory pass reads a sibling switch)" ;;
m6) expect_red test/settings-form.test.mjs "m6 (a card union loses an option)" ;;
esac

echo "done; the trap restores, rebuilds and reports the marker count"
