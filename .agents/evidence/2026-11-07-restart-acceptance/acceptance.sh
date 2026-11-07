#!/usr/bin/env bash
# Post-restart acceptance for the four commits pending restart.
# Criterion: last src/ commit 44b70d4 @ 2026-11-07T09:27:32+08:00.
# The host must have STARTED after that instant; a build or commit time means nothing.
#
# Deliberately no `set -e`: every probe below must reach its own fail branch, and an empty
# command substitution is the normal "not found" path here, not an abort.
repo=/mnt/Data/Projects/dsh-project-context
crit=$(date -d '2026-11-07T09:27:32+08:00' +%s)
crit_h=$(date -d "@$crit" '+%F %T')
fail=0

echo "criterion: $crit_h (last src/ commit 44b70d4)"

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

# 3. Informational: the raised cap is only provable by a write that exceeded the old 40000.
size=$(wc -m <"$repo/.agents/memory/MEMORY.md")
echo "INFO memory: ${size} chars (cap is 45000; a value above 40000 means the raised cap took effect)"

# 4. Informational: refusals logged after this pid started.
# `$start` is an epoch while `ps lstart` is human text — never feed one to the other's parser.
start_epoch=$(date -d "$(LC_ALL=C ps -o lstart= -p "${pid:-0}" 2>/dev/null)" +%s 2>/dev/null)
stamp=$(date -d "@${start_epoch:-0}" '+%F %T' 2>/dev/null)
echo "INFO errors.log: $(grep -c 'would have been stored lossily' "$repo/.agents/memory/errors.log" 2>/dev/null || echo 0) line(s) total; confirm none are newer than ${stamp:-<unknown>}"

echo
if [ "$fail" -eq 0 ]; then
	echo "RESULT: PASS — the four commits are loaded"
else
	echo "RESULT: FAIL — not loaded (or unverifiable); do not trust the fixes yet"
fi
exit "$fail"
