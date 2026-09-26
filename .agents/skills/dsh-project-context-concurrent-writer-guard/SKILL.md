---
name: dsh-project-context-concurrent-writer-guard
description: "Safely stage and commit in the dsh-project-context repo when another dsh agent session may be editing the same files."
---

Purpose: safely edit and commit in /mnt/Data/Projects/dsh-project-context when another dsh agent session may be editing the same files.

Triggers: before any edit or commit in this repo when more than one dsh session is known or suspected (for example, a handoff continuation, a second agent in the same cwd, or a target file mtime newer than your own last write).

Procedure:
1. Detect a concurrent writer. List session dirs under ~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/ or the equivalent encoded-cwd directory; compare mtimes. For the files you plan to touch, run `stat -c '%y %n' <paths>`. Treat a session dir or file mtime within a few minutes as active.
2. Before editing, read the current content and `git diff -- <paths>`. Never overwrite an edit you did not make. If a compile error or duplicate definition appears (for example, two implementations of the same function in src/handoff.ts), stop; the other writer may still be mid-edit.
3. Enter the idle window: wait until the other writer's target file mtime has stopped changing. In the session logs, waiting until the other session's last write was several minutes old was enough. Re-read the files after the wait.
4. Edit only the files scoped to the current task. After edits, run `pnpm typecheck` and `pnpm test` (prepend the current Node 22 bin dir to PATH; the Nix store path rotates, so run `node -v` first). Run `pnpm build` only for client-side changes.
5. Commit with a scoped add: `git add <exact paths>`, never `git add -A` or `git add .`. Inspect `git diff --cached` to confirm no other session's changes are included. Commit in English Conventional Commits (`fix:`, `docs:`, etc.).
6. Push only after `git status --short` shows only your files plus the repo's normal untracked entries (.agents/, thinking-effort-loaded.json). If another session's changes are staged or committed, do not rewrite history; coordinate with the user.
7. Do not restart the user's dsh web or dsh-desktop to make your change live; propose the restart instead. Record open tasks in .agents/memory/CONTEXT.md or .agents/memory/HANDOFF.md, not in skills or commit messages.

Expected outcome: your task's files are committed and pushed without clobbering another live session's work, and the tree is left clean except the normal untracked artifacts.
