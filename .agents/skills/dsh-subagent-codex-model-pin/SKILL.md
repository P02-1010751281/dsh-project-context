---
name: dsh-subagent-codex-model-pin
description: "Choose, validate and pin the model id for the desktop profile's subagent-codex plugin (subagent_codex tool): read the gateway catalog by `slug`, smoke-test candidates for real with `codex exec`, prefer `auto/` route groups over single-account ids, edit only the `model:` line under `- id: subagent-codex`, and leave the host restart to the user."
derived_from: autolearn
evidence: ["session-95164f99-376c-4a3c-a9ff-1e48e53310ea", "session-a43aa39f-dd7b-4918-9ecb-ae6b45ca5668"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Pin a new model for `subagent-codex`

## When to use

- `subagent_codex` fails at thread start (`Model metadata for <id> not found`, reconnect loops) because the pinned id is absent from the gateway catalog.
- The user asks to change`/strengthen the model behind the `subagent_codex` tool, or rules an existing model family out as old/weak (then it must not be the answer even where an id exists).
- A previously pinned id needs re-validation.

## 1. Locate the pin by key, never by line number

```bash
P=~/.dsh/profiles/desktop/cordis.patch.yml
grep -n -A4 'id: subagent-codex' "$P"        # config: model: is the only model knob
grep -n 'maxMemoryChars' "$P"               # cheap neighbours can change under you
```

The plugin's declared config is only `providerName / model / env / permissionMode / disposeGraceMs`; there is no reasoning-effort field, so a profile-side edit can only move `model`. A platform settings-card save rewrites the whole file, so re-read these keys after any save.

## 2. Read the catalog by `slug`, not `id` or `name`

```bash
python3 - <<'PY'
import json
models = json.load(open('/home/user/.codex/magpie-models.json'))['models']
print('total', len(models), 'keys', sorted(models[0]))
for m in models:
    if m.get('slug') in {'auto/claude-opus-5-5', 'gpt-5.6-luna'}:
        print(m['slug'], m.get('context_window'), m.get('default_reasoning_level'))
PY
```

Guessing the key name produces a false negative that reads as "id not in catalog". Also list the family the user excluded (`grep` the slug prefix) so you can state exactly which ids exist.

## 3. Smoke-test every candidate for real, serially, one round each

```bash
for id in auto/claude-opus-5-5 auto/gpt-6.2-astra apikeyfan/claude-opus-5-5; do
  ( time timeout 150 codex exec --sandbox read-only \
      -C /mnt/Data/Projects/dsh-project-context -m "$id" \
      'Reply with exactly: READY' </dev/null ) > "logs/$id.log" 2>&1
  echo "$id exit=$?"
done
```

Record per id: exit code, whether the reply contains `READY`, wall seconds, and the reported token usage. Zero output after the timeout is unusable regardless of the name. A rejected id reproduces the original failure signature, which is your control.

Probe from an already-trusted cwd (this repo, not `/tmp`): codex appends a `[projects."/tmp"] trust_level` block to `~/.codex/config.toml` otherwise.

Reasoning effort is a gateway/codex-side knob here, not a profile key: test it with `-c model_reasoning_effort='"high"'` and treat a changed token count as proof the override reached the model; otherwise report it as an untested lever.

## 4. Rank the survivors

- Prefer an `auto/…` route-group id over the same model behind a single account prefix (`apikeyfan/…`): an account can answer `403 insufficient balance` while the route group passes on every attempt, so the route group does not die with one upstream account.
- Keep a different-vendor route as fallback.
- Never pick a family the user ruled out, and never pick an id you only inferred from a name.

## 5. Edit one line, then prove the file

```bash
cp "$P" "/tmp/cordis-before-subagent-model-$(date +%Y%m%d%H%M%S).yml"
# change only: model: <new id>   inside the `- id: subagent-codex` entry
python3 - <<'PY'
import yaml
p='/home/user/.dsh/profiles/desktop/cordis.patch.yml'
doc=yaml.safe_load(open(p))
entries=doc if isinstance(doc,list) else []
for e in entries:
    if isinstance(e,dict) and e.get('id')=='subagent-codex': print('entry', e)
PY
grep -c 'gpt-5.6-luna' "$P"   # expect 0 for the retired id
grep -n 'maxMemoryChars' "$P" # value unchanged
```

Do not bump the profile's git sha pin for this: only evidence/docs changed, `lib/` did not.

## 6. Hand the restart over, then re-verify

A plugin instance reads its config at apply, so the pin only takes effect at the next desktop host start; do not restart the host yourself. Ask for the restart, then re-run the step-3 smoke against the pinned id (routing can change within minutes), and confirm the live host runs the code you expect.

## Pitfalls

- A `thread/start` that returns a thread id proves nothing; the real reason sits on the app-server stderr.
- An id that exists in the catalog can still fail; an id that is absent fails deterministically. Always test, never read names as strength.
- Reported catalog counts drift (108 vs 109 in one session): recount and print the number you actually read.
- If you state the catalog "has no such id", re-check your accessor key before saying it to the user.

## Config-file traps (`~/.codex/config.toml`)

The plugin path runs the store build of `@openai/codex@0.153.4` (`run.ts:44` → `bin.codex` → `app-server --stdio`), not the PATH `codex`; the two parse the file differently, so `codex --version` decides
which rules apply.

- `async_compaction` must be spelled `[features] async_compaction = true` — a **boolean**. Store build
  0.153.4 fails `thread/start` with `invalid type: map, expected a boolean` on the nested
  `[features.async_compaction] enabled = true` table; the PATH CLI 0.169.0 reads only the boolean.
  Deleting the block also fixes 0.153.4, which has no such feature at all: `features list` was 135
  rows with no entry, and `--enable` / `features enable` answered `Unknown feature flag` (exit 1).
  Those 135 rows were measured on that build, which is **no longer in this store** (2026-11-26: only
  0.171.0 remains, 224 rows) — re-measure on the build you actually have instead of quoting 135.
- Unknown keys are silent on 0.153.4 (even a fabricated `[bogus_section_xyz]` earns no warning), so
  "no warning" never means "recognised"; `thread/start` also returns a thread id for a nonexistent
  model, so a handshake is not a model-call test.
- A failure surfaces as `stage: thread-start; category: unknown`; the real reason is on the
  app-server stderr, which `run.ts:261` copies to the host stderr — there is no per-child log.
- With cwd `/tmp`, codex appends `[projects."/tmp"] trust_level = "trusted"` to the config itself.
  Probe from an already-trusted cwd and prove the config's sha256 unchanged afterwards.
