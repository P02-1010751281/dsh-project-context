---
name: dsh-project-context-maintenance
description: "Route a maintenance task on this repo's four project-context plugins to the command, file or procedure skill that owns it: memory document edits and cap pressure, session archive and INDEX gaps, handoff that did or did not fire, and autolearn skill distillation. Load this first, then the procedure skill its row names."
---

Entry point for the four plugins — ① `project-context` archive, ② `project-memory` consolidation, ③ `project-autolearn` distillation, ④ `project-handoff` handoff. Run the row's first action, then load the procedure skill it names; the detail stays there, and command syntax lives in [README.md](../../../README.md).

| Plugin | Task in front of you | First action | Procedure skill |
|---|---|---|---|
| ② | Change or compress memory content; the document sits near its cap | `/memory` for the paths and status, then whole-line replacement with a read-back | `dsh-project-memory-cap-guard` |
| ② | Content is missing after a pass refused or wrote partially | newest `MEMORY.md.memory-backup-*` against the last commit | `dsh-memory-doc-loss-repair` |
| ② | Content is missing from an unknown cause (poisoned JSON, a short reply, an older writer still running) | tail `.agents/memory/errors.log`, then the journal | `agents-memory-recovery` |
| ② | Prove a write lands without dropping entries, before it lands | the offline probes `.agents/evidence/*/share-fit.mjs` and `roundtrip.mjs` | `dsh-memory-budget-fit-offline-verify` |
| ② | The four-section shape broke, or must be rebuilt | `src/project-memory/memory-schema.ts` | `dsh-memory-four-section-migration` |
| ② | Local artifacts only grow (backups, rotated logs, candidates) | `/memory prune` previews; `/memory prune --apply` archives into `trash/<date>.tar` before deleting | — |
| ① | An archived session is absent from `.agents/memory/session-logs/INDEX.md`, or a line points at nothing | the directory list against the index file | `dsh-session-index-adoption-audit` |
| ① | Archive the current session now, or back-fill old archives | `/session-log write`, `/session-log import <path…>` | — |
| ① | The `~/.dsh` session store looks inconsistent | `~/.dsh/sessions` read-only, before any repair | `dsh-session-store-maintenance` |
| ① | The archive manager reports a corrupt or unreadable session | that session's own log, before any rewrite | `dsh-session-archive-repair` |
| ④ | Did handoff fire for a session, and if not, why | `/handoff status` for the target session, quoted with its workspace and session id | `dsh-handoff-auto-trigger-forensics` |
| ④ | The seed may have dropped the last turn or the user's decision | the parent's `session.jsonl` | `dsh-handoff-seed-completeness-forensics` |
| ④ | Force a handoff, or move the threshold, tail budget or pending rule | `/handoff` to hand off now; `threshold auto` / `threshold <ratio>`, `budget recent <tokens>`, `pending defer` / `pending wait` | — |
| ③ | Distil a skill now, or review the waiting candidates | `/autolearn`, `/autolearn list`, `/autolearn approve <name>`, `/autolearn reject <name>`; candidates in `.agents/memory/skill-candidates/` | — |
| ③ | Two skills teach the same rule | `ls .agents/skills`, then search the rule across the corpus | `dsh-skill-corpus-consolidation` |
