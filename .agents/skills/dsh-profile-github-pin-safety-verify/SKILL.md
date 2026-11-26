---
name: dsh-profile-github-pin-safety-verify
description: "Verify whether a dsh profile's dependency pin written as the `github:<owner>/<repo>` shorthand (with or without `#<sha>`, or a `git+ssh://…`/`link:`/`file:` variant) is safe to trust or re-install: resolve what commit it actually installs, prove the remote is fetchable without ssh keys, prove installed lib parity, and report the drift risk without editing a user-set pin line."
derived_from: autolearn
evidence: ["session-17f125e2-f157-4ce9-9fe1-6a9d4f815020", "session-95ba96da-d9db-4904-bc83-220ec0f133a4"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Verify a dsh profile pin before trusting it

Use when a profile's `package.json` pins this package (`dsh-project-context` / a sibling plugin) by shorthand — `github:<owner>/<repo>`, `github:<owner>/<repo>#<sha>`, `git+ssh://…#<sha>`, `file:x.tgz` or `link:` — and you must say whether the installed code is what the pin claims, and what a reinstall would do. Read-only probing of `~/.dsh/profiles/*` is fine; keep one-off probes in `/tmp` and treat the pin line as the user's.

## 1. Read the pin as written

```bash
grep -n 'dsh-project-context' ~/.dsh/profiles/<profile>/package.json
```

Grep the dependency key, never a line number (shifts on every settings save). Record the exact form: `link:` (live tree), `file:` tgz, `git+ssh://…#<sha>`, `github:owner/repo`, `github:owner/repo#<sha>`, `github:owner/repo#<tag>`.

A tag is a fourth pin form, and pnpm resolves it to the peeled commit before writing the lock — so it installs exactly what a sha pin would — measured 2026-11: `v0.5.0` peels from `f6164c7` to `28d2459`, and the lock's `resolution:` block then reads the same `{commit, repo, type: git}` whichever spec form you installed from (a git dependency carries **no** `integrity:` hash — compare `resolution.commit`, not hashes), while `specifier:` keeps the tag name. Prefer it for readability when the repo's convention is that released tags are never re-cut; prefer a sha when you need immutability that survives someone moving the tag, because a fresh resolve re-reads whatever the tag points at then.

## 2. Read what the lockfile actually installs

```bash
grep -n -A6 'dsh-project-context' ~/.dsh/profiles/<profile>/pnpm-lock.yaml | head -80
```

Find the `resolution.commit:` (or the `repo/commit` in the integrity key) for that package. All four `insert` entries share one package, so one commit covers the host half and the client half.

Also record `lockfileVersion` in that file — a different-major pnpm on `PATH` will rewrite it.

## 3. Prove what a fresh resolve would pick (scratch dir only)

Never run install inside the profile to test a pin.

```bash
mkdir -p /tmp/pin-probe && cd /tmp/pin-probe
printf '{"name":"pin-probe","private":true}\n' > package.json
# exact sha form
pnpm add --lockfile-only 'github:<owner>/<repo>#<sha>'
grep -n 'commit' pnpm-lock.yaml
# bare shorthand form
rm -rf node_modules pnpm-lock.yaml
pnpm add --lockfile-only 'github:<owner>/<repo>'
grep -n 'commit' pnpm-lock.yaml
```

Then compare the bare form's resolved commit with the branch head at the same moment:

```bash
git ls-remote origin refs/heads/main
```

Conclusion to draw: `#<sha>` locks the commit; bare `github:owner/repo` resolves to the default branch's *then-current* HEAD, so it is safe only as long as the lockfile still names that commit. It stops being safe on `rm pnpm-lock.yaml`, `pnpm install --force`, or a copy to another machine without the lockfile.

## 4. Prove the remote needs no ssh key

codeload serves the tarball anonymously, so a `github:` source installs on a box with no ssh key for that repo:

```bash
for sha in <sha1> <sha2>; do
  printf '%s ' "$sha"
  curl -s -o /dev/null -w '%{http_code}\n' -I "https://codeload.github.com/<owner>/<repo>/tar.gz/$sha"
done
```

Expect `200` for each. Then compare with the `git+ssh://` alternative: `git ls-remote origin` must also succeed for that form to work at all.

## 5. Prove installed parity

For every file that matters (`lib/**`, `client` bundle entry), compare the installed artifact to the pinned commit:

```bash
git show <sha>:lib/<path> | sha256sum
sha256sum ~/.dsh/profiles/<profile>/node_modules/dsh-project-context/lib/<path>
```

`package.json` may be compared semantically only. If the installed tree equals the commit, the pin is honest even when the pin string is not what you would have written.

Also check whether the installed commit already equals `HEAD`'s `src/`, `lib/`, `client/`, `test/` (`git diff --stat <sha> HEAD -- src lib client test`); an older-looking sha that is byte-identical on code needs no re-pin.

## 6. Report, do not edit

- A pin line the user wrote by hand is theirs: state the measured risk and the recommended form (`github:<owner>/<repo>#<sha>`), and wait for a ruling rather than rewriting it.
- Installed code loads only after the host restarts. Judge liveness from the running host (pid start time plus the resident module), never from a successful install.
- Copy the profile's `package.json` / `pnpm-lock.yaml` / `cordis.patch.yml` to `.bak-<date>-<purpose>` before any change, and remember that a settings-card save rewrites `cordis.patch.yml` wholesale.

## Pitfalls

- Tool output can render two different literals as the same text (repo name, dependency key and package name colliding). When deciding whether two names are equal, compare byte lengths, code points or hex prefixes — never the printed string.
- `pnpm` on `PATH` may be a different major than the one the profile used; prefer the store-pinned pnpm so the lockfile is not silently rewritten.
- Network failures on `git+ssh` installs are not tree corruption: pnpm `git checkout <sha>` failing with exit 128 means the commit was unreachable, and a `git push` may report failure while having landed — judge by `git ls-remote origin` and the push exit code.
