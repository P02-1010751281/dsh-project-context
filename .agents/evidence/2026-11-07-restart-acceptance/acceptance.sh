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

# 3. Informational: a memory write above 40000 is hard evidence the raised cap took effect.
size=$(wc -m <"$repo/.agents/memory/MEMORY.md")
echo "INFO memory: ${size} chars (cap is 45000; a value above 40000 means the raised cap took effect)"

# 4. Informational: refusals logged after this pid started.
# `$start` is an epoch while `ps lstart` is human text — never feed one to the other's parser.
start_epoch=$(date -d "$(LC_ALL=C ps -o lstart= -p "${pid:-0}" 2>/dev/null)" +%s 2>/dev/null)
stamp=$(date -d "@${start_epoch:-0}" '+%F %T' 2>/dev/null)
echo "INFO errors.log: $(grep -c 'would have been stored lossily' "$repo/.agents/memory/errors.log" 2>/dev/null || echo 0) line(s) total; confirm none are newer than ${stamp:-<unknown>}"

echo
if [ "$fail" -eq 0 ]; then
	echo "RESULT: PASS — every commit up to ${crit_hash:-<unknown>} is loaded"
else
	echo "RESULT: FAIL — not loaded (or unverifiable); do not trust the fixes yet"
fi
exit "$fail"
