# Post-restart acceptance probe (2026-11-07)

Decides, after the user's desktop restart, whether the four commits listed below are actually
loaded. Written while `session-2829b3f7` was still on the pre-restart host, because that restart
kills the session and anything living only in the conversation would be lost.

## The criterion

A build or commit time proves nothing; the host must have **started** later than the last
`src/`-touching commit:

| | |
|---|---|
| criterion commit | `44b70d4` |
| criterion time | `2026-11-07T09:27:32+08:00` |
| pre-restart host | pid `5455`, started `2026-11-06 23:02:04` → **not loaded** |

Commits pending that restart (all later than the pid's start):

| commit | time | what |
|---|---|---|
| `5efaef8` | 23:11 | read-cap gate (`read-capped-refused`) |
| `874ca18` | 23:20 | changelog for the above |
| `324dcb7` | 09:06 | `maxMemoryChars: 45000` decision + criterion record |
| `44b70d4` | 09:27 | fit-clip refusal + skeleton-reply context withhold |

Plus the `maxMemoryChars: 45000` profile change written at 09:00, which also needs the restart.

## Run it

```bash
bash .agents/evidence/2026-11-07-restart-acceptance/acceptance.sh; echo "exit=$?"
```

It prints one line per check and ends with `RESULT: PASS` / `RESULT: FAIL`, exiting non-zero on
failure. The socket holder is discovered by process name (`MainThread`) rather than by port,
because the GUI port changes on every restart.

The criterion is **re-derived on every run** (`git log -1 -- src/`), so the table above is that
batch's snapshot rather than something the script replays. The first revision pinned it; see the
revision note at the bottom for what that cost.

## What it checks, and what it deliberately cannot

| check | meaning |
|---|---|
| `PASS load` | the process holding the GUI socket started later than the criterion — the only proof of load |
| `PASS lib` | committed `lib/` still matches HEAD, so no stale artifact is being served |
| `INFO memory` | `MEMORY.md` size; a value above 40000 is hard evidence the raised cap took effect (the old cap would have clipped it) |
| `INFO errors.log` | total `would have been stored lossily` lines, for the user to compare against the new start time |

`--verify-only` on `/etc/nixos/scripts/dsh-desktop-restart.sh` is **not** a substitute: it proves
the store/wrapper match, not that the running process loaded them.

## The fail branch is proven, not assumed

A PASS from a probe whose failure path was never exercised is worthless, so the probe was run
against the pre-restart host and had to fail. Actual output, `2026-11-07 09:37`:

```
criterion: 2026-11-07 09:27:32 (last src/ commit 44b70d4)
NOT LOADED: pid 5455 started 2026-11-06 23:02:04 — not later than 2026-11-07 09:27:32
PASS lib: committed artifacts match HEAD
INFO memory: 39587 chars (cap is 45000; a value above 40000 means the raised cap took effect)
INFO errors.log: 41 line(s) total; confirm none are newer than 2026-11-06 23:02:04

RESULT: FAIL — not loaded (or unverifiable); do not trust the fixes yet
exit=1
```

The no-listener branch was exercised separately (feeding an empty pid list) and also reported
`FAIL load: no listening 'MainThread' found`.

One bug was found and fixed by that control: the `errors.log` line originally built the timestamp
with `date -d "@$(ps -o lstart=)"`, mixing an epoch-format argument with human-readable `lstart`,
which silently printed an empty stamp. It now converts `lstart` → epoch → formatted text, and
prints `<unknown>` rather than an empty field when the conversion fails.

`LC_ALL=C` is applied to `ps -o lstart=` on purpose: the default locale here is Chinese, and its
`lstart` text is not parseable by `date -d`.

## Revision 2026-11-07 10:10: the pinned criterion

Running this probe right after commit `49083b7` (the `clipped` cleanup) printed
`criterion: 2026-11-07 09:27:32 (last src/ commit 44b70d4)` — the hardcoded pair from the first
revision — while the live host (`pid 37757`, started `09:38:45`) predated that commit and therefore
did **not** carry it. The probe said `RESULT: PASS`. That is the exact failure it exists to prevent:
a pinned criterion keeps measuring the batch it was written for, so every later commit inherits a
green light.

The criterion and its hash are now derived per run, and an underivable criterion is its own failing
check rather than an empty operand on `[ "$start" -gt "$crit" ]` (which is an
`integer expression expected` error, not a verdict). All three branches were exercised afterwards:

| branch | how | result |
|---|---|---|
| host predates the criterion | the real run at 10:11 | `NOT LOADED` → `RESULT: FAIL`, exit 1 |
| criterion underivable | a `git` shim on `PATH` that exits 1 | `FAIL criterion` + `FAIL load`, exit 1, no arithmetic error |
| host later than the criterion | a throwaway copy pinned to `09:27:32` | `PASS load` → `RESULT: PASS`, exit 0 |
