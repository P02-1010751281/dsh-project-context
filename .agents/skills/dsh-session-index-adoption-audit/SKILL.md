---
name: dsh-session-index-adoption-audit
description: "Audit and repair the archived-session index (session-logs/INDEX.md) in a dsh-project-context project: detect stranded legacy <memory>/session-index.md entries, verify against the filesystem instead of grep, and run the adoption path under the cross-process lock."
---

## When to use

The project's own `session-logs/INDEX.md` may silently disagree with what is archived on disk. This happens when two hosts straddled the layout move (dsh wrote `session-logs/INDEX.md`, an older build still wrote `<memory>/session-index.md`), when a cap dropped the document head and the legacy file was removed with it, or when a legacy index was adopted only while the new index was empty. Autolearn navigates by this index, so a missing line means a session that is archived yet invisible.

## Key invariant

A session is lost only when it is **archived on disk and absent from `INDEX.md`**. A line in `INDEX.md` whose archive is *missing* is harmless (the reader verifies against the filesystem). So the count/coverage of index lines is the authority — not a UUID grep. A UUID grepped inside another session's *title* (e.g. "failed to observe session 371fe260…") looks like a dead entry and is a false alarm.

## Procedure

1. Enumerate the ground truth: every archive directory under the project's `session-logs/`, then classify by what it actually holds — do not assume the usual pair. 226 directories on 2026-11-26 included 2 with only `meta.json` (no `session.jsonl`) and 14 with no `session.md`, because a handoff child can be bound before it is ever talked to. Note the count by schema/harness — an archive can be dsh-shaped (`data` with named events, `harness:"dsh"`, numeric `createdAt`) or pi-shaped (one bare `message` event, `message.role`, block type `toolCall`, ISO `timestamp`). Count both.
2. Read `session-logs/INDEX.md` and count its index lines (not headings, not prose). Compare against step 1. A gap means stranded entries.
3. Look for the legacy source: `<memory>/session-index.md` (the project memory dir, sibling of `session-logs/`). It is *not* the same file as `session-logs/INDEX.md` and has a different `.gitignore`.
4. Classify each missing session: is its id present in the legacy file, or was it never indexed anywhere? Only legacy-file lines are adoptable through the existing code path.
5. Repair by driving the real code path, not hand-editing: run the archive/import pass that calls `queueIndexLine` so the merge-on-every-write logic adopts the legacy lines. If the project is this repo (dsh-project-context), the plugin's archive pass over `~/.dsh/sessions/<encoded-cwd>/` does it; the plugin writes `INDEX.md`, so do not hand-write the file.
6. Confirm the post-state, all four checks: (a) adopted count matches, (b) index line count grew by exactly that many, (c) the legacy `<memory>/session-index.md` is gone (removed only after every line it held survived), (d) zero dangling lines — every line's archive exists on disk.
7. If the pass is run while a host is serving, remember the whole read→merge→write→remove sequence must run under `withMemoryLock` on `<memory>/session-index` (lock file `<memory>/session-index.lock`). Concurrency check: N processes × M distinct lines must leave N×M lines; before the lock it left ~28 of 100.

## Traps

- `archived.size === 0` (nothing archived this pass) skips the automatic adoption pass; a force/`/autolearn`-style invocation still spends the model call. To adopt without a model call, drive the archive/import surface, not the autolearn surface.
- Ordering matters for a different reason now: the index is regenerated wholesale from each session's `meta.json` and has no line cap (`MAX_INDEX_LINES` is gone — `grep -rn MAX_INDEX_LINES src/` is empty), so a stale ordering is what hides rows, not a truncation. Keep each line's date authoritative.
- Removing the legacy file at the cap destroys the only copy of any dropped line — the removal is gated on every line surviving, plus a re-`stat` so an append into the read→remove window is not deleted with it.
- The legacy path is read only when `stat().isFile()` and the body holds ≥1 index line; a FIFO would stall the per-project write chain and a hand-written note must not be consumed.
- Running only one test file can miss the credential-redaction pinning test; a mutation check must run at least the file that owns the pinning test.
