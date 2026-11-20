---
name: dsh-subagent-codex-model-pin-verify
description: "Choose or replace the model id pinned for the subagent-codex plugin in a dsh profile, and prove it actually serves: read the required config key, enumerate the live gateway catalog, smoke candidates read-only, then edit the single pin line, restart, and confirm a routed call."
derived_from: autolearn
evidence: ["session-95164f99-376c-4a3c-a9ff-1e48e53310ea", "session-e24b9d97-6793-4872-bd69-eeb0e8302fc9"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Pin the subagent-codex model in a dsh profile and prove it runs

Use when the user wants a different model behind `subagent_codex` (the pinned id is old/weak, or a thread fails to start). Never pick by model name — pick by a real smoke run.

## 1. Establish the key, not the default

- `subagent-codex`'s `config.model` is a required string (`z.string().min(1)`); when it is omitted the plugin inherits `~/.codex/config.toml`'s default route, which is usually a weak/flash default and does not satisfy a "strong model" ask. The pin must be written explicitly.
- Find the pin: grep the key in the target profile, e.g. `grep -n -A4 'subagent-codex' ~/.dsh/profiles/desktop/cordis.patch.yml`. Grep the key, never cite a line anchor: the platform's settings page rewrites the whole file and line numbers drift.
- A profile whose pin is an explicit `git+ssh://…#<sha>` never auto-upgrades; read the pin fresh instead of assuming the host was updated.

## 2. Enumerate the live gateway catalog

- Catalog: `~/.codex/magpie-models.json`. Count and list ids from it every time — do not assume an id exists.
- An id that is not in the catalog leaves `subagent_codex` failing at thread start, with no fallback to the inherited default. Verify before pinning.
- Drop ids the user ruled out on quality grounds even if the catalog carries them (luna family was ruled old/weak and never an acceptable answer).

## 3. Smoke each candidate read-only

For every surviving candidate id, run a real call and record outcome plus the reasoning effort actually used:

```
codex exec --sandbox read-only -m <catalog-id> '<probe prompt>'
```

Report per id: did a thread start, did it answer, at what effort. Choose from that table, not from the name.

## 4. Edit one line, then restart

- Change only the `model:` value for the `subagent-codex` entry in that profile's `cordis.patch.yml`. Do not touch unrelated keys in the same file.
- Re-read the file right after any platform settings save: settings pages persist the whole document through `settings.mutate`, so a save can clobber a hand-edited key. Record the new value you actually read back.
- The change takes effect only at the next host restart, which is user-only: hand the user the restart, then verify.

## 5. Verify it serves

- Confirm a `subagent_codex` thread starts at all (a bad pin fails immediately at thread start).
- Confirm the call left on the intended route: the dsh router log `~/.config/magpie/*.jsonl` records each routed call with its provider/model pair, status and effort (past days compressed).
- Do not declare success from a green smoke alone; the profile pin plus a live routed call is the evidence.

## Notes

- Never verify by executing `/memory update` or any state-writing pass as part of this workflow; keep probes read-only.
- If a rewrite of the profile is needed under the store-pinned pnpm, use the pnpm that ships with the dsh store — PATH's pnpm is a different major and rewrites `pnpm-lock.yaml`.
