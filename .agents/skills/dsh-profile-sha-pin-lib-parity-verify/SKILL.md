---
name: dsh-profile-sha-pin-lib-parity-verify
description: "Repoint the dsh desktop/web profile SHA pins at a freshly pushed dsh-project-context commit, install with the profile store's pinned pnpm, and prove byte-parity of the installed lib/ (and the new symbols) against `git show <sha>` so the next host restart loads exactly that commit."
derived_from: autolearn
evidence: ["session-41767aa6-c144-4c8d-b6d2-1150bb69bee9", "session-6baddac5-1f84-49f3-b92b-fedcb3b839aa"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Upgrade a dsh profile's SHA pin and prove lib/ parity

Use when a dsh-project-context change is committed and pushed and the installed dsh profiles must carry it, before the user restarts the host. The changed code is NOT live until the pin is bumped, installed, and the host restarted.

## 1. Read the commit you are installing

```bash
git rev-parse HEAD origin/main    # must be equal; never quote a sha from memory
```

Keep the full sha for the pin line and the short form for the report.

## 2. Find out how each profile installs the package

```bash
grep -n '"dsh-project-context"' ~/.dsh/profiles/*/package.json
```

- `git+ssh://git@ssh.github.com:443/P02-1010751281/dsh-project-context.git#<sha>` → sha pin, editable here.
- `link:/mnt/Data/Projects/dsh-project-context` (`ctxdev`) → follows the tree; never rewrite it.
- `file:./vendor/dsh-project-context-<ver>.tgz` → different path (repack, fix the lockfile integrity line, compare files); do not treat it as a pin bump.

Never assert a profile uses `link:` (or a pin) without reading that `package.json`.

## 3. Rewrite only the sha fragment

Edit the one line in each sha-pinned profile (`desktop`, `web`), keeping the rest byte-identical. Grep for the key to locate it — line numbers drift; do not reuse a number from an earlier read or from a doc.

## 4. Install with the store-pinned pnpm

Run the install per profile directory using the pnpm version the profile store pins (the output names it, e.g. `using pnpm v11.27.0`). The pnpm on `PATH` is a different major and will rewrite `pnpm-lock.yaml`; do not use it.

## 5. Prove the installed bytes are the commit

For every tracked `lib/` file in the commit, compare sha256 against the installed copy and print a count:

```bash
for f in $(git ls-tree -r --name-only <sha> -- lib); do
  a=$(git show <sha>:$f | sha256sum | cut -d' ' -f1)
  b=$(sha256sum ~/.dsh/profiles/<profile>/node_modules/dsh-project-context/$f | cut -d' ' -f1)
  [ "$a" = "$b" ] || echo "MISMATCH $f"
done
echo "checked N"
```

Report it as `N files, 0 mismatches` per profile. Also confirm the lockfile resolution line carries the new commit (`grep -n 'resolution: {commit:' pnpm-lock.yaml`).

## 6. Prove the change reached the build

Grep the installed bundle for a symbol or string the commit introduced (e.g. a new exported name in `lib/project-memory/consolidate.js`, a new schema key in the settings schema, one `tablist` in `lib/client.js`). `lib/**` is tracked, so it must have been rebuilt and committed before the pin bump — a pin to a commit whose `lib/` was not rebuilt installs stale behaviour.

For a client change, compare `lib/client.js` against the repo copy by sha256 after stripping the trailing `//# sourceMappingURL=` comment, which makes the byte sizes differ.

## 7. Report state honestly

- The resident host still runs the previously loaded commit until it restarts; say so instead of claiming the change is live.
- Restart is user-only: `/etc/nixos/scripts/dsh-desktop-restart.sh` exits 3 from inside a dsh session; only `--dry-run` / `--verify-only` are safe for you, and `--verify-only` can fail for reasons outside this repo (another desktop alive).
- Client changes additionally need `pnpm build` plus a tab hard refresh after the restart.
- An explicit SHA pin never auto-upgrades, so read the pin rather than assuming the host was updated.
