#!/usr/bin/env bash
# Handoff-title batch acceptance — did the label naming reach the running host?
#
# The batch's only observable surface is the title a handoff writes to its child
# (`src/project-handoff/conversation.ts`'s `handoffLabel`, consumed and backstopped by
# `perform.ts`'s `retitleAfterRename`). Nothing offline can prove the running host calls it, so
# there are two independent checks:
#
#   1. the load criterion — the process holding 127.0.0.1:19387 started *after* the last `src/`
#      commit, and the committed `lib/` is what a fresh `tsc` compiles;
#   2. the observed title — a handoff child created after that process started.
#
# Check 2 alone may not fail the batch. `handoffLabel` returns the parent's short id when the parent
# carries no *human* input (`source.kind === "user"`, and not a continuation banner), so the bare-id
# form is the documented outcome for a chain the user never typed into — the exact shape the old code
# always produced. Reporting that as a failure would name the wrong cause, so each observed bare-id
# child has its parent resolved: it only fails when that parent *does* carry human input, in which
# case the new code must have labelled the child. A child whose parent can't be resolved is reported
# as unresolved, never as a failure.
#
# Source read for the shape discriminator (read-now command, no store path pinned here):
#   V=$(dsh --version); R=/nix/store/*dsh-desktop-$V/lib/dsh-desktop/repo
#   $R/packages/session/session-title/src/index.ts   — the plugin's `rename` writes
#        `source: { kind: 'user' }` and "A user rename pins the title: no automatic revision may
#        override it" (`if (this.get(session)?.source.kind === 'user') return`).
#   $R/packages/session/session-title/src/invariant.ts — `messageSeqs` is empty *iff*
#        `source.kind === 'user'`; anything automatic cites an earlier human `user/message`.
# So a child titled by our own `rename` shows one `session/title` with `source.kind:"user"` and an
# empty `messageSeqs`, while an ordinary session can show a `fallback`/`provider` upgrade.
#
# Run:  bash .agents/evidence/2026-10-07-handoff-title-load-verify/verify.sh
# Exit 0 = the criterion passed (and, where observable, a label was seen instead of a bare id).

set -uo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$root" || exit 1
if [ ! -f package.json ] || [ ! -d src/project-handoff ]; then
	printf 'not the repo root: %s\n' "$root" >&2
	exit 1
fi

PREFIX='↪ handoff · '
fail=0
ok() { printf '  PASS  %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }
note() { printf '  ..    %s\n' "$1"; }

printf '== 0. the probe agrees with the artifact it judges ==\n'
lit=$(grep -o 'HANDOFF_TITLE_PREFIX = "[^"]*"' lib/project-handoff/marker.js 2>/dev/null | sed 's/.*= "//; s/"$//')
if [ "$lit" = "$PREFIX" ]; then
	ok "the prefix literal matches lib/project-handoff/marker.js"
else
	bad "prefix literal \"$PREFIX\" does not match lib/ (\"${lit:-missing}\") — this probe would judge the wrong string"
fi
if grep -q 'function handoffLabel' lib/project-handoff/conversation.js 2>/dev/null &&
	grep -q 'function retitleAfterRename' lib/project-handoff/perform.js 2>/dev/null; then
	ok "lib/ carries both handoffLabel and retitleAfterRename"
else
	bad "lib/ is missing handoffLabel or retitleAfterRename — the batch was not built into lib/"
fi

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
if [ "$holder" -gt 0 ] && [ "$holder" -gt "$srct" ]; then
	ok "holder start is later than the last src/ commit (margin $((holder - srct))s)"
	loaded=1
else
	bad "holder started at or before the last src/ commit — the batch is NOT loaded"
	loaded=0
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

printf '== 3. a handoff child created after the holder started ==\n'
if [ "$holder" -le 0 ]; then
	bad "skipped: no holder start time to scope the search to"
else
	since=$(date -d "@$holder" '+%Y-%m-%d %H:%M:%S')
	children=0; labelled=0; idform=0; discriminating=0; unresolved=0; undated=0; others=0
	while IFS= read -r -d '' f; do
		case "$f" in
		*.zstd) j=$(zstdcat "$f" 2>/dev/null) ;;
		*) j=$(cat "$f") ;;
		esac
		[ -n "$j" ] || continue
		title=$(printf '%s' "$j" | jq -r 'select(.type == "session/title") | .data.title // empty' 2>/dev/null | head -1)
		[ -n "$title" ] || continue
		# The file mtime is only a cheap prefilter: a session republished to v4 gets a fresh mtime
		# without being new, so this would judge pre-restart children against post-restart code.
		# What decides "created after the holder" is the title event's *own* time.
		ttime=$(printf '%s' "$j" | jq -r 'select(.type == "session/title") | .time // empty' 2>/dev/null | head -1)
		case "$ttime" in
		'' | *[!0-9]*)
			undated=$((undated + 1))
			continue
			;;
		esac
		[ "$((ttime / 1000))" -gt "$holder" ] || continue
		case "$title" in
		"$PREFIX"*) ;;
		*)
			# Negative control: an ordinary session is titled by the service (fallback then provider),
			# never by our `rename`, so its shape must differ from a handoff child's.
			others=$((others + 1))
			if [ "$others" -le 3 ]; then
				osrc=$(printf '%s' "$j" | jq -r 'select(.type == "session/title") | (.data.source.kind // "?")' 2>/dev/null | head -1)
				oseqs=$(printf '%s' "$j" | jq -r 'select(.type == "session/title") | ((.data.messageSeqs // []) | length)' 2>/dev/null | head -1)
				printf '  control %s  title="%s"  source=%s messageSeqs=%s\n' \
					"$(basename "$(dirname "$f")")" "$title" "${osrc:-?}" "${oseqs:-?}"
			fi
			continue
			;;
		esac
		children=$((children + 1))
		suffix=${title#"$PREFIX"}
		short=$(basename "$(dirname "$f")")
		seqs=$(printf '%s' "$j" |
			jq -r 'select(.type == "session/title") | ((.data.messageSeqs // []) | length)' 2>/dev/null | head -1)
		src=$(printf '%s' "$j" | jq -r 'select(.type == "session/title") | (.data.source.kind // "?")' 2>/dev/null | head -1)
		printf '  child %s  title="%s"  source=%s messageSeqs=%s  titled %s\n' "$short" "$title" "${src:-?}" "${seqs:-?}" \
			"$(date -d "@$((ttime / 1000))" '+%Y-%m-%dT%H:%M:%S%z')"
		if printf '%s' "$suffix" | grep -qE '^[0-9a-f]{8}$'; then
			idform=$((idform + 1))
			seed=$(printf '%s' "$j" |
				jq -r 'select(.type == "user/message" and ((.data.source.kind // "") == "dsh-project-context")) | .data.content[0].text // empty' 2>/dev/null | head -1)
			parent=$(printf '%s' "$seed" | grep -oE 'session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
			puuid=${parent#session-}
			human=""
			if [ -z "$puuid" ]; then
				unresolved=$((unresolved + 1))
				note "no seed banner on $short — cannot resolve its parent, so its bare id is not judged"
			else
				pd=$(find "$HOME/.dsh/sessions" -maxdepth 2 -type d -name "*${puuid}*" 2>/dev/null | head -1)
				pf=""
				[ -n "$pd" ] && pf=$(find "$pd" -maxdepth 1 -type f -name 'session*.jsonl*' 2>/dev/null | head -1)
				if [ -z "$pf" ]; then
					unresolved=$((unresolved + 1))
					note "parent $parent has no readable log here, so the bare id is not judged"
				else
					case "$pf" in
					*.zstd) pj=$(zstdcat "$pf" 2>/dev/null) ;;
					*) pj=$(cat "$pf") ;;
					esac
					# Deliberately wider than `isHandoffContinuationText`: dropping every banner-looking
					# message can only make this probe *less* likely to fail, never a false failure.
					human=$(printf '%s' "$pj" |
						jq -r 'select(.type == "user/message" and ((.data.source.kind // "") == "user")) | .data.content[0].text // empty' 2>/dev/null |
						grep -vE '^(从会话 |Handoff from session )' | grep -E '[^[:space:]]' | tail -1)
				fi
			fi
			if [ -n "$human" ]; then
				if [ "$loaded" -eq 1 ]; then
					discriminating=$((discriminating + 1))
					bad "child $short keeps the bare parent id while parent $parent carries human input \"$(printf '%s' "$human" | head -c 40)\" — the label is not live"
				else
					note "child $short keeps the bare parent id while parent $parent carries human input, but the holder predates the last src/ commit — a bare id is what the old code writes here, so this cannot discriminate until the restart"
				fi
			else
				note "child $short keeps the bare parent id — not discriminating: parent $parent carries no human-typed input, the documented fallback"
			fi
		else
			labelled=$((labelled + 1))
			ok "child $short is titled \"$suffix\" — the label naming is live"
		fi
	done < <(find "$HOME/.dsh/sessions" -name 'session*.jsonl*' -type f -newermt "$since" -print0 2>/dev/null)
	printf '  counted: children=%s labelled=%s bare-id=%s of-which-discriminating=%s unresolved=%s undated=%s others=%s\n' \
		"$children" "$labelled" "$idform" "$discriminating" "$unresolved" "$undated" "$others"
	if [ "$others" -gt 0 ]; then
		note "$others non-handoff session(s) also started after the holder — the control lines above must show a non-user source citing at least one message seq"
	fi
	if [ "$children" -eq 0 ]; then
		note "no handoff child has been created since the holder started — unobservable yet, rely on check 1"
	fi
fi

printf '\n%s\n' "$([ "$fail" -eq 0 ] && echo 'RESULT: PASS' || echo 'RESULT: FAIL')"
exit "$fail"
