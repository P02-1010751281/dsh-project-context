# Project Context

Last updated: 2026-10-04T16:53:52+08:00

## Summary

Batch C tier A ("the receipt names the loss") is implemented, gate-green and pushed, and batch B is
still what the desktop host is actually running. A consolidation pass can lose project memory in five
reachable places, all of them before or at the write, so the stored document cannot show any of them:
the input fit (`fitMemoryInput`, `src/shared/conversation.ts`) clips the stored memory and context
head-and-tail to fit the model's output budget; the section render (`renderMemoryDocument`,
`src/project-memory/sections.ts`) drops whole entries that overflow a section's budget; the stored
context is sliced to `MAX_CONTEXT_CHARS` before the fit sees it; the context render
(`renderContextDocument`) clips its own sections; and the write path (`normalizeMemoryDocument`)
caps the document once more — which is the only trace an opaque, non-four-section reply's loss ever
had. None of the five reached the `/memory update` receipt, because `ConsolidateReport` was a string
union and `MemoryInput.clipped` a bare boolean, so a pass that dropped twelve entries produced a
receipt identical, character for character, to a clean one. Tier A makes `ConsolidateReport` a
report object with two written flags and six loss counts, adds per-artifact hidden-character counts to
`MemoryInput` and `ConsolidationOutcome`, words the receipt by mechanism and only for artifacts that
landed, and removes the three "logged once per project" gates so every lossy write or unusable
context leaves its own `errors.log` line. It changes no behaviour: a lossy pass still writes. An
independent adversarial review falsified the first version's narrower claim on three paths (including
one that was completely silent) and all of them are closed; the review's dispositions and the two
accepted residuals are in `docs/batch-c-loss-receipt-brief.md`, and the reproduction with recorded
numbers is in `.agents/evidence/2026-10-04-memory-loss-receipt/`. The running desktop host (pid 4539,
started 2026-10-04 16:02:06) predates this change, so the new receipt is **on disk, not yet live**
until the user restarts the host in their own terminal.

## Key points

- Tier A landed: `ConsolidateReport` is `{status, memoryWritten, contextWritten, memoryHiddenChars,
  contextHiddenChars, contextDroppedChars, memoryWriteDroppedChars, sectionDropped, droppedItems,
  itemTruncated}` with `ConsolidateStatus` the old string union. The counts describe only what landed
  (a refused memory write zeroes the memory-side counts, an unwritten context zeroes the context-side
  ones), the receipt names only the artifacts that actually landed, and a clean pass that wrote both
  produces the byte-identical wording it produced before the change, so "the sentence did not change"
  still means "nothing was lost".
- The three per-project log gates (`memorySectionClipLogged`, `contextClipLogged`,
  `contextUnusableLogged`) are gone, and the write-path cap logs at all: a project that stays over
  budget or keeps sending an unusable context loses content every pass, so reporting only the first
  occurrence silenced the rest. Two counter-honesty fixes ride along: `itemTruncated` no longer counts
  an entry the same render then drops whole, and a reply below the 40-character floor is logged.
- Tier B (refuse a lossy write) and tier C (refuse after one targeted retry) are deliberately **not**
  implemented. B risks self-lock (this repo's memory rides near the 32000-character cap) and C needs
  the retry contract designed; A is their prerequisite because it computes the counts they would use.
- Accepted residuals, both documented with the review's reproduction in
  `docs/batch-c-loss-receipt-brief.md`: `clipped` with all counts zero is reachable when the hidden
  artifact did not land (inventing a count there would be the misattribution this repo warns about),
  and the memory-side loader cap is not counted (a hand-edited over-cap `MEMORY.md` is reported by
  `/memory status` and the stored marker, not by the receipt).
- Mutation rounds: five mutants across two rounds, each compiling with 0 errors, landing its marker in
  `lib/`, and killing exactly its own new test; `src/` was restored from a `sha256sum`-verified `/tmp`
  copy and rebuilt to 0 markers. One first attempt was voided because it left an import unreferenced
  (`tsc` `TS6133`), which is not a valid red.
- Gate numbers are not recorded here: run `pnpm typecheck` / `pnpm build` / `pnpm test` and read the
  counts fresh (`pnpm test` now includes the nine cases added by tier A).
- MEMORY.md is the fixed four-section schema written in English, and it must stay inside every
  per-section share *and* under the 800-character per-entry cap or the next write silently drops or
  clips entries. Verify with `.agents/evidence/2026-10-04-memory-four-section-migration/probe.mjs`,
  never by counting characters: the mechanism that lost content is invisible in the stored file.
- rewind is disposed on both halves. The user removed the declaration from
  `/etc/nixos/home-manager/user/programs/dsh.nix` (that file's mtime moved and the whole-line grep is
  empty), and the `web` profile was cleaned with the store-pinned pnpm (PATH's is a different major
  and rewrites `pnpm-lock.yaml`): the rewind dependency row, its `bundles` row, its lock references
  and `node_modules/dsh-rewind-plugin` are all gone, and the lock diff was removals only. Why no
  activation can bring it back is read from source, not inferred: the HM module builds one
  ensure-missing command per `cfg.plugins` entry and never deletes, and it only targets the `web`
  profile — with the entry gone there is no command mentioning it. Pre-cleanup manifests are kept at
  `~/.dsh/profiles/web/{package.json,pnpm-lock.yaml}.bak-2026-10-04-rewind-local-half` and
  `/tmp/rewind-local-half-2026-10-04-rewind-local-half/`.

## Open tasks

- Tier A is on disk but not live: the desktop host serving 127.0.0.1:19387 was started before this
  change, so `/memory update` still returns the old receipt until the user restarts the host in their
  own terminal (the restart script is user-only; an agent may run only `--dry-run` / `--verify-only`).
  Verify loaded-versus-not from the socket holder's start time against `git log -1 --oneline -- src/`,
  and confirm afterwards with `lib/` diffing clean against a fresh `tsc` compile.
- rewind: only the empirical check is left, and only the user can run it. After their next
  `home-manager switch`, `node_modules/dsh-rewind-plugin` should still be absent, because the
  activation generates no command for an entry that is no longer declared. No agent action.
- Tier B and tier C remain unimplemented by ruling, so a lossy consolidation pass still writes; the
  residual is recorded in `CHANGELOG.md` and `docs/batch-c-loss-receipt-brief.md` rather than fixed.
  If C is wanted later, it starts from tier A unchanged.
- Batch B residuals recorded and deliberately not fixed: the autolearn `max-tokens` retry-before-read
  asymmetry; pi's `callAux` no-tool fallback and `needsCondense` second call were not ported; a call
  that was fixed but labelled `stop` still cannot be identified.
- Out-of-repo residuals: upstream dsh core splitting `discovery.ts`'s `capacity()` into declared
  window plus usable input so `qualityLimit`'s upstream branch can be wired; pi's `resolveThreshold`
  `!model || usage.tokens === null` and its truncated-retry guard coverage.
- Keep watching memory headroom through the API (`loadMemory` plus `isMemoryTruncated`, and the
  archived probes' per-section costs), never through a written character count.
