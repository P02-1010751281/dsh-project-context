#!/usr/bin/env bash
# Negative controls for measure.mjs: the share gate must go red on a padded copy *before* any content
# would be lost, and the loss path must be reachable too. The tracked document itself must stay green.
#
# The padded copies are built in a temp dir, so nothing here touches .agents/memory/CONTEXT.md.
# Note the deliberate absence of `set -e`: the whole point is to run commands that are expected to
# exit non-zero and branch on the code, so an aborting shell would make those branches unreachable.
set -uo pipefail

cd "$(dirname "$0")" || exit 2
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0

SRC="../../../.agents/memory/CONTEXT.md"

# pad <out> <item chars> <item count> — insert N bullets of M characters before the standing-guard bullet.
pad() {
	node --input-type=commonjs -e '
		const fs = require("fs");
		const [src, out, chars, count] = process.argv.slice(1);
		const lines = fs.readFileSync(src, "utf8").split("\n");
		const at = lines.findIndex((line) => line.startsWith("- Standing guard unchanged"));
		if (at < 0) { console.error("anchor bullet not found"); process.exit(2); }
		const bullet = `- ${"x".repeat(Number(chars))}`;
		lines.splice(at, 0, ...Array.from({ length: Number(count) }, () => bullet));
		fs.writeFileSync(out, lines.join("\n"));
	' "$SRC" "$1" "$2" "$3"
}

run_case() { # <label> <expected exit> <path>
	local label="$1" expected="$2" path="$3" code
	node measure.mjs "$path" > "$tmp/out.txt" 2>&1
	code=$?
	if [ "$code" -eq "$expected" ]; then
		printf 'PASS  %-28s exit %s as expected\n' "$label" "$code"
	else
		printf 'FAIL  %-28s exit %s, expected %s\n' "$label" "$code" "$expected"
		sed 's/^/        /' "$tmp/out.txt" | tail -10
		fail=1
	fi
}

# 1. the tracked document is green.
run_case "tracked CONTEXT.md" 0 "../../../.agents/memory/CONTEXT.md"

# 2. thin but still lossless: inside the budget, past the 90% fill gate. No clip, no marker — only the
#    preventive gate can catch this, which is exactly the state Open tasks was in at 99.7%.
pad "$tmp/thin.md" 390 3
run_case "padded to ~92% (thin)" 1 "$tmp/thin.md"
grep -q "byte-identical: true" "$tmp/out.txt" || { echo "FAIL  the thin case was expected to stay a fixpoint"; fail=1; }

# 3. past the budget: the renderer starts dropping trailing items, so the loss path is reachable too.
pad "$tmp/lossy.md" 700 3
run_case "padded past budget (loss)" 1 "$tmp/lossy.md"

if [ "$fail" -eq 0 ]; then
	echo "RESULT: PASS"
else
	echo "RESULT: FAIL"
fi
exit "$fail"
