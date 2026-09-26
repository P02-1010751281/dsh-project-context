---
name: dsh-project-context-release
description: "Cut and publish a versioned release of the dsh-project-context plugins: update version and CHANGELOG, run the full gate, create and push an annotated tag with a release note, and verify the tag on origin."
---

Release workflow for the dsh-project-context plugins (repo root /mnt/Data/Projects/dsh-project-context).

1. Check the working tree and concurrent-session state.
   Run `git status --short`. Untracked `.agents/` and `thinking-effort-loaded.json` are normal. A second dsh agent session may be working in this repo and can leave changes staged. Never run `git add -A`. Stage only the release paths (`git add <paths>`) and commit with `git commit -F <msg> -- <paths>` so another session's staged work is not swept in.

2. Update version and changelog.
   The changelog is `CHANGELOG.md`, not the README; the README only points to it. Move completed entries from the `未发布` section into a new version heading in `CHANGELOG.md`. Set `version` in `package.json` to the release version. Keep README prose wrapped at 100 columns and never split an inline code span across lines. Use English Conventional Commits (`feat:`, `fix:`, `docs:`, `chore(release):`).

3. Run the full gate under the correct Node.
   Run `node -v`; the Nix store path rotates on rebuild, so prepend the real Node 22 path to PATH before pnpm scripts. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`. `pnpm test` must pass (expected count). When stdout is not a TTY, `node --test` prints TAP (`# pass N`) instead of `ℹ pass`; check the exit code, not a grep for the reporter.

4. Commit the release changes.
   Stage only the files changed for the release (e.g. `package.json`, `CHANGELOG.md`, `README.md`). Commit with a message such as `chore(release): vX.Y.Z`.

5. Create and push an annotated tag.
   Write the release note to a file (a `/tmp` path is fine; the durable copy is the tag object once pushed). Create the tag with `git tag -a vX.Y.Z -F <note-file>`. Push the branch with `git push origin main` and the tag with `git push origin refs/tags/vX.Y.Z`.

6. Verify the tag on origin.
   `git ls-remote origin refs/tags/vX.Y.Z` must show both the tag object and the peeled `^{}` commit. `github.com` is unreachable from this host; only `ssh.github.com:443` works. An `ls-remote` can fail transiently through the local proxy; retry it. `gh` is not installed, so any GitHub UI step is for the user.

7. Wrong or superseded tags.
   Delete a wrong local tag with `git tag -d vX.Y.Z` and the remote with `git push origin :refs/tags/vX.Y.Z`. This repo has no GitHub Releases, so a removed tag leaves nothing to clean up on the Releases page; do not hunt for one.

8. After the release.
   If host-side code changed, run `pnpm build` and propose a host restart (do not restart the user's `dsh web` or desktop host unprompted); host code loads only from the built `lib/*.js`. Client bundle changes are live via HMR after `pnpm build`, but open tabs need a hard reload.
