#!/usr/bin/env bash
# Post-restart acceptance for the last src/-touching commit.
# The criterion is RE-DERIVED on every run: a host must have STARTED after the last commit that
# touched src/, and a build or commit time means nothing. Do not pin it — a pinned criterion silently
# keeps measuring the batch it was written for, so it would report PASS for a host that predates
# everything committed since.
#
# Deliberately no `set -e`: every probe below must reach its own fail branch, and an empty
# command substitution is the normal "not found" path here, not an abort.
repo=/mnt/Data/Projects/dsh-project-context
fail=0

crit_hash=$(git -C "$repo" log -1 --format=%h -- src/ 2>/dev/null)
crit=$(git -C "$repo" log -1 --format=%ct -- src/ 2>/dev/null)
if [ -n "$crit" ]; then
	crit_h=$(date -d "@$crit" '+%F %T')
	echo "criterion: $crit_h (last src/ commit ${crit_hash:-<unknown>})"
else
	crit_h="<underivable>"
	echo "FAIL criterion: cannot derive the last src/ commit time from $repo — refusing to judge load"
	fail=1
fi

# 1. Which process holds the GUI socket now, and when did it start?
pid=$(ss -ltnp 2>/dev/null | grep -o 'MainThread",pid=[0-9]*' | head -1 | grep -o '[0-9]*$')
if [ -z "$pid" ]; then
	echo "FAIL load: no listening 'MainThread' found — is the desktop host running?"
	fail=1
else
	# LC_ALL=C so lstart stays parseable by date(1); the default locale here is Chinese.
	start_s=$(LC_ALL=C ps -o lstart= -p "$pid" 2>/dev/null)
	start=$(date -d "$start_s" +%s 2>/dev/null)
	if [ -z "$start" ]; then
		echo "FAIL load: cannot resolve the start time of pid $pid (raw: '$start_s')"
		fail=1
	elif [ -z "$crit" ]; then
		# Comparing against an empty operand is an "integer expression expected" error, which would
		# fall through to whichever branch bash took rather than to a verdict. Fail loudly instead.
		echo "FAIL load: no criterion time to compare pid $pid against (see the criterion line above)"
		fail=1
	elif [ "$start" -gt "$crit" ]; then
		echo "PASS load: pid $pid started $(date -d "@$start" '+%F %T') — later than the criterion"
	else
		echo "NOT LOADED: pid $pid started $(date -d "@$start" '+%F %T') — not later than $crit_h"
		fail=1
	fi
fi

# 2. The committed build artifacts must still match HEAD (a stale lib/ is the silent failure).
if git -C "$repo" diff --exit-code -- lib >/dev/null 2>&1; then
	echo "PASS lib: committed artifacts match HEAD"
else
	echo "FAIL lib: lib/ differs from HEAD"
	fail=1
fi

# 3. Informational only, and it cannot do more than this: the stored length is a property of
#    the document, and it sits below both 40000 and 45000, so the two caps are
#    indistinguishable from here. Do not read this number as proof the raised cap took effect —
#    take the configured value from the profile's `maxMemoryChars` and confirm the behaviour
#    with a `/memory update`.
size=$(wc -m <"$repo/.agents/memory/MEMORY.md")
echo "INFO memory: ${size} chars stored (non-discriminating for the cap; see the comment in this script)"

# 4. A cap-loss refusal logged AFTER this host instance started would mean the raised cap is
#    not in effect. Entry timestamps are UTC (`2026-11-07T01:38:36.657Z`) while `ps lstart` is
#    local human text — convert both to epochs and never compare the two texts.
#    `$start` is an epoch; feeding it to `date -d` as text is the bug this guard replaces.
start_epoch=$(date -d "$(LC_ALL=C ps -o lstart= -p "${pid:-0}" 2>/dev/null)" +%s 2>/dev/null)
log="$repo/.agents/memory/errors.log"
count=$(grep -c 'would have been stored lossily' "$log" 2>/dev/null); count=${count:-0}
last_ts=$(grep 'would have been stored lossily' "$log" 2>/dev/null | tail -1 | cut -d' ' -f1)
last_epoch=""
[ -n "$last_ts" ] && last_epoch=$(date -d "$last_ts" +%s 2>/dev/null)
if [ "${count:-0}" -eq 0 ]; then
	echo "PASS errors.log: no cap-loss refusal has ever been logged"
elif [ -z "$last_epoch" ] || [ -z "$start_epoch" ]; then
	# An unreadable timestamp is its own failure, never a pass: `[ -gt ]` on an empty operand
	# prints 'integer expression expected' and exits non-zero without being a verdict.
	echo "FAIL errors.log: cannot place ${count} cap-loss entr(ies) against the host start (last '${last_ts:-<none>}', start '${start_epoch:-<unknown>}')"
	fail=1
elif [ "$last_epoch" -gt "$start_epoch" ]; then
	echo "FAIL errors.log: a cap-loss refusal was logged at $(date -d "@$last_epoch" '+%F %T') — after this host started ($(date -d "@$start_epoch" '+%F %T')); the raised cap may not be in effect"
	fail=1
else
	echo "PASS errors.log: ${count} cap-loss entr(ies), latest $(date -d "@$last_epoch" '+%F %T') — none newer than this host ($(date -d "@$start_epoch" '+%F %T'))"
fi

# 5. The reasoning-effort signature (`SCNet: thinking.type=disabled cannot be translated …`). It can
#    only be produced by a request that carried no reasoning effort: dsh's pi-ai adapter omits
#    `reasoning` when none is named, and pi-ai's anthropic translator then writes
#    `thinking: {type: "disabled"}`. Naming `off` does not escape it either (the adapter maps `off`
#    to `undefined`), so one of these logged AFTER this host started means either d8ee04f is not
#    loaded or a call site still omits the effort. Judged exactly like (4): entry times are UTC,
#    host start is local text, so both go to epochs and the texts are never compared.
eff_count=$(grep -c 'cannot be translated' "$log" 2>/dev/null); eff_count=${eff_count:-0}
eff_ts=$(grep 'cannot be translated' "$log" 2>/dev/null | tail -1 | cut -d' ' -f1)
eff_epoch=""
[ -n "$eff_ts" ] && eff_epoch=$(date -d "$eff_ts" +%s 2>/dev/null)
if [ "${eff_count:-0}" -eq 0 ]; then
	echo "PASS errors.log: the reasoning-effort signature has never been logged"
elif [ -z "$eff_epoch" ] || [ -z "$start_epoch" ]; then
	echo "FAIL errors.log: cannot place ${eff_count} reasoning-effort entr(ies) against the host start (last '${eff_ts:-<none>}', start '${start_epoch:-<unknown>}')"
	fail=1
elif [ "$eff_epoch" -gt "$start_epoch" ]; then
	echo "FAIL errors.log: 'thinking.type=disabled cannot be translated' logged at $(date -d "@$eff_epoch" '+%F %T') — after this host started ($(date -d "@$start_epoch" '+%F %T')); the effort fix is not in effect on this instance"
	fail=1
else
	echo "PASS errors.log: ${eff_count} reasoning-effort entr(ies), latest $(date -d "@$eff_epoch" '+%F %T') — none newer than this host ($(date -d "@$start_epoch" '+%F %T'))"
fi

echo
if [ "$fail" -eq 0 ]; then
	echo "RESULT: PASS — every commit up to ${crit_hash:-<unknown>} is loaded"
else
	echo "RESULT: FAIL — not loaded (or unverifiable); do not trust the fixes yet"
fi
exit "$fail"
