---
name: dsh-plugin-mutation-round
description: "Run a valid mutation round in dsh-project-context: edit src/ only, prove each mutant compiles and reaches lib/ and changes behaviour, capture the named test that turns red, then restore src/ from a hashed copy and rebuild to zero markers."
---

Use when you need to verify that a dsh-project-context behaviour is actually pinned by a test, or when validating the regression test added by a fix. A mutant only counts if it is valid; an invalid mutant's red is not evidence.

Steps
1. Name the behaviour and the test that owns it (the file carrying the pinning test). One deliberate wrong edit per mutant.
2. Start from a green gate: `pnpm test` (= `tsc && node --test`). Read the exit code; non-TTY `node --test` prints TAP, so never grep an interactive reporter. Do not run `node --test test/` with a bare directory (it fails); use the package script.
3. Edit `src/` only. Never edit `lib/*.js`: the build overwrites it and the mutation yields a false SURVIVED.
4. Run `pnpm build`, then confirm the mutant reached the build output: locate it with `grep -n "<MARKER> = " lib/`. Do not use `grep -cF` for a marker that sits inside a tagged template — tsc emits tagged templates as `String.raw` followed by the template with an inserted space, so an exact in-template grep legitimately returns 0 and looks like a failed restore or a missing mutant.
5. Validity trio — a red from a mutant that fails any of these is not evidence: (a) it compiles, `tsc` 0 errors (a TS6133 unused-symbol error means the mutant is malformed; reshape it so every symbol stays referenced, e.g. keep both the configured target and the quality cap referenced when mutating the threshold chain); (b) its marker is present in `lib/` after the build; (c) it demonstrably changes behaviour on a probe input.
6. Run the scoped test that owns the pinning (at minimum the file named in the task, not the whole suite): the mutant must fail it, and the restored source must pass it.
7. Restore `src/` from a hash-verified `/tmp` copy (`sha256sum -c`), never via `git checkout --` or `git stash`. Restoring `src/` does NOT restore `lib/`.
8. End the round with a rebuild and confirm the mutant marker count in `lib/` is 0, then re-run the full gate (typecheck, build, full test count, `lib/client.js` size if client code moved) before reporting.
9. Report per mutant: killed or survived, the test that failed, and the validity-trio evidence. A SURVIVED mutant means the pin is missing — add or strengthen the test rather than re-running the same mutant.

Traps
- Do not fix a wording classifier by patching the pattern: two rounds that swap the same error class back and forth mean a discriminator is missing. The durable fix is a discriminator (e.g. a bounded-prefix value-noun guard) plus a mutation-checked test.
- Residual, documented best-effort misclassifications are known accepted; do not present them as fixed and do not spend a mutant round on them.
- When several sessions or teammates may be writing, snapshot `src/` (copy + `sha256sum`) before delegating and verify with `sha256sum -c` after the writer settles; an unrestored mutation is unverified work. See the teammate guard and concurrent-writer guard skills for the delegation/staging side.
- Scope each mutant to the smallest edit that inverts the behaviour; a broad edit that breaks unrelated tests proves nothing about the pin you care about.
