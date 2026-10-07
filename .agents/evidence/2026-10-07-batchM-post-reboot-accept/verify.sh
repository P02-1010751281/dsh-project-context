#!/usr/bin/env bash
# Batch M post-reboot acceptance — is the injected pressure line live in the running host?
#
# Batch M's entire observable surface is one `systemPrompt.context` contribution
# (`src/project-handoff/display.ts`'s `handoffPressureText`). Nothing offline can prove that the
# host renders it, so the acceptance is two independent checks, both re-derived here:
#
#   1. the load criterion — the process holding 127.0.0.1:19387 started *after* the last `src/`
#      commit, and the loaded `lib/` is the committed one (a fresh `tsc` compile differs only by
#      `lib/client.js`, the esbuild client bundle that is not a tsc artifact);
#   2. the behavioural half — the exact line appears inside a real `runtime-context` user message
#      in a session that started after that process. The search is scoped to that message *source*
#      on purpose: `grep` over a session log also matches the agent's own commands and their
#      output, so a raw string count proves nothing.
#
# Run:  bash .agents/evidence/2026-10-07-batchM-post-reboot-accept/verify.sh
# Exit 0 = every check passed.

set -uo pipefail
# `../..` from this file is `.agents`, not the repo; resolve the root and prove it, so an empty
# `git log -- src/` (a wrong cwd silently returns nothing, not an error) cannot read as "no commit".
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$root" || exit 1
if [ ! -f package.json ] || [ ! -d src/project-handoff ]; then
	printf 'not the repo root: %s\n' "$root" >&2
	exit 1
fi

# The literal opening of `handoffPressureText`'s zh branch; the closing paren is dropped so the
# command line itself does not contain the full string a log would echo.
MARK='自动交接状态（宿主注入，非用户发言'
fail=0
ok() { printf '  PASS  %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

printf '== 1. load criterion: the socket holder started after the last src/ commit ==\n'
pid=$(ss -ltnp 2>/dev/null | sed -n 's/.*127\.0\.0\.1:19387.*pid=\([0-9][0-9]*\).*/\1/p' | head -1)
holder=0
if [ -z "$pid" ]; then
	bad "nothing is listening on 127.0.0.1:19387"
else
	etimes=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
	if [ -z "$etimes" ]; then
		bad "pid $pid reports no etimes"
	else
		holder=$(( $(date +%s) - etimes ))
	fi
fi
srct=$(git log -1 --format=%ct -- src/)
printf '  holder  pid=%s  started %s\n' "${pid:-none}" \
	"$([ "$holder" -gt 0 ] && date -d "@$holder" '+%Y-%m-%dT%H:%M:%S%z' || echo '?')"
printf '  src/    %s  committed %s\n' "$(git log -1 --format=%h -- src/)" \
	"$(date -d "@$srct" '+%Y-%m-%dT%H:%M:%S%z')"
if [ "$holder" -gt "$srct" ]; then
	ok "holder start is later than the last src/ commit (margin $((holder - srct))s)"
else
	bad "holder started at or before the last src/ commit — the batch is NOT loaded"
fi

printf '== 2. the loaded lib/ is the committed one ==\n'
if [ -z "$(git status --porcelain -- lib)" ]; then
	ok "git reports lib/ clean"
else
	bad "lib/ has uncommitted changes"
fi
tmp=$(mktemp -d)
if node_modules/.bin/tsc --outDir "$tmp" >/dev/null 2>&1; then
	extra=$(diff -rq lib "$tmp" 2>&1 | grep -v 'client\.js' || true)
	if [ -z "$extra" ]; then
		ok "lib/ matches a fresh tsc compile (lib/client.js the only extra file)"
	else
		bad "lib/ differs from a fresh compile:"
		printf '%s\n' "$extra"
	fi
else
	bad "tsc failed"
fi
rm -rf "$tmp"

printf '== 3. the line is live inside a runtime-context message ==\n'
if [ "$holder" -le 0 ]; then
	bad "skipped: no holder start time to scope the search to"
else
	since=$(date -d "@$holder" '+%Y-%m-%d %H:%M:%S')
	hits=0
	while IFS= read -r -d '' f; do
		case "$f" in
		*.zstd) j=$(zstdcat "$f" 2>/dev/null);;
		*) j=$(cat "$f");;
		esac
		[ -n "$j" ] || continue
		# Only user messages whose source is the harness's runtime-context snapshot can carry a
		# `systemPrompt.context` contribution; tool calls/results that quote the marker are not it.
		n=$(printf '%s' "$j" |
			jq -r 'select(.type == "user/message" and ((.data.source.kind // "") == "runtime-context")) | .data.content[0].text // ""' 2>/dev/null |
			grep -c "$MARK")
		if [ "${n:-0}" -gt 0 ]; then
			hits=$((hits + 1))
			printf '  HIT   %s\n' "${f#"$HOME"/.dsh/sessions/}"
			printf '%s' "$j" |
				jq -r 'select(.type == "user/message" and ((.data.source.kind // "") == "runtime-context")) | .data.content[0].text // ""' 2>/dev/null |
				grep -o "$MARK.*" | head -1 | sed 's/^/        /'
		fi
	done < <(find "$HOME/.dsh/sessions" -name 'session*.jsonl*' -type f -newermt "$since" -print0 2>/dev/null)
	if [ "$hits" -gt 0 ]; then
		ok "$hits session(s) started after the holder carry the line"
	else
		bad "no session started after the holder carries the line — it is loaded but not live"
	fi
fi

printf '\n%s\n' "$([ "$fail" -eq 0 ] && echo 'RESULT: PASS' || echo 'RESULT: FAIL')"
exit "$fail"
