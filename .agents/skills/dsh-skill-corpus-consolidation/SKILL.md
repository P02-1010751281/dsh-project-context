---
name: dsh-skill-corpus-consolidation
description: "Consolidate duplicated rules across the tracked .agents/skills corpus of dsh-project-context into single ownership: audit the corpus, convert extra copies into pointers to one owner, verify survival of every rule, and leave the corpus fully staged."
---

1. Take a read-now inventory; never reuse a remembered count.
   - On disk: `ls -d .agents/skills/*/`
   - Tracked: `git ls-files '.agents/skills/**/SKILL.md'`
   Compare by directory name, not by file count (a skill directory may hold more than one file). A directory present on disk but absent from the tracked list was written straight into `.agents/skills/` by a concurrent session (there is no candidate queue on that path): git shows only a bare `??`, nothing errors, and it surfaces at clone time. Before staging it, check frontmatter, section structure, and that it carries no secrets.

2. Keep the audit artifact at `.agents/evidence/<date>-skill-corpus-audit/audit.md` with (a) a purpose table, one row per skill; (b) an overlap matrix, skill × the rule it restates; (c) a numbered actions section listing each merge item with its status, so a later round resumes where the last one stopped instead of re-auditing from scratch.

3. Dedup by exact name only. The autolearn admission path compares the candidate's `skill.name` against existing names, so one rule spelled under two names survives twice, and two different rules sharing a name collide silently. When two skills are one rule under two names, keep one name, delete the other file, and prove no rule was lost by grepping every symbol/rule named in the audit afterwards.

4. For each rule restated in more than one skill, pick a single owner, keep the rule stated inline there, and replace every other copy with the same one-sentence pointer naming the owner — do not paraphrase the rule into the pointer. Keep a deliberate duplicate copy only when the audit records the reason for it (the `/etc/nixos` launcher copy is such an exception).

5. Apply edits by whole-line replacement and read the line back. The failure mode here is a prefix `replace` that rewrites the first half of a line and leaves a duplicated tail; after the batch, read back the changed lines and check that the same sentence does not occur twice in one line.

6. Verify survival, not just absence of error: `git grep -oF '<string>' -- .agents/` for every symbol/rule named in the audit; re-run both listings from step 1; and confirm a rule moved to a new owner is greppable in that owner. Trust the diff over the commit message when a fix is claimed.

7. Stage scoped and commit scoped: `git add <paths>`, then `git commit -F <msg> -- <paths>`; never `git add -A`, because another agent session may be writing skills at the same time.

8. Skills are tracked because they cannot be regenerated from a clone (the session logs that feed autolearn are gitignored), so run the step-1 comparison again at the end of the round: a consolidation that leaves skills unstaged loses them silently downstream.
