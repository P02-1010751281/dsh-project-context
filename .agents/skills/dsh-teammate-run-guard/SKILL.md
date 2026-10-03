---
name: dsh-teammate-run-guard
description: "Delegate work to in-process dsh teammates in the dsh-project-context repo without losing in-flight work or leaving a teammate's src/ mutation unrestored."
---

Use this whenever you delegate work to dsh teammates (in-process agents spawned from the session) in /mnt/Data/Projects/dsh-project-context, especially read-only audits and mutation checks that may touch src/.

Pre-flight
1. Fix each teammate's write scope up front; everything outside it stays read-only.
2. If a teammate will mutate source, snapshot first: copy every file it may touch (at minimum src/) to a /tmp path and record `sha256sum` for each file.
3. Put the snapshot path, the restore command (`cp -a /tmp/<snap>/. src/`), and the sha256 verification command directly into the teammate's task text — not only into your own notes.
4. Give every teammate a fixed report path under /tmp and require it to append findings as it goes, so partial work survives a kill.

While teammates run
5. Never hand off, compact, or end the turn while any teammate is running. Before any such action, run list_agents and either wait for every running teammate to settle or interrupt it explicitly.
6. Treat `send_message` to an inactive member as untrusted: `accepted` does not prove a turn started. Confirm with list_agents and team_task_list, never with the send result.
7. Do not wait for a failure event from a dead teammate. Teammates are in-process — they have no entry under ~/.dsh/sessions, emit only provisioning → active, and simply stop appearing in list_agents.

Recovery and cleanup
8. After every teammate settles or dies, run the recorded `sha256sum -c` over the snapshotted files. Treat any unrestored mutation as unverified work and restore it before continuing.
9. Restoring `src/` does not restore `lib/`: a later probe would read the mutant build and give false results. The mutant lifecycle — restore from the hash-verified copy, then rebuild and confirm the marker count in `lib/` is 0 — is owned by `dsh-plugin-mutation-round`; do not restate it here.
10. If a teammate dies mid-task, look first for its /tmp artifacts (snapshot, probes, partial report) and finish the work from them instead of blindly re-spawning.

Mutation validity
11. What makes a mutant *valid* — it compiles with 0 errors, its marker reached `lib/` after the build, and it demonstrably changes behaviour on a probe input — is defined once in `dsh-plugin-mutation-round`. A compile error such as TS6133 from an unused symbol is not a behavioural difference and produces an invalid red; a teammate's mutant is only evidence once that round is complete.
