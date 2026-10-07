---
name: dsh-core-mechanism-liveness-verify
description: "Use when a question or tracked claim is about what the running dsh host actually does (a gate, event/waterfall site, service semantics, or a mechanism such as automatic compaction, session titling or handoff): pin the store checkout the running host loaded, read that source, then prove the mechanism is live on this machine from archived session events with a shape discriminator and a negative control."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# dsh core mechanism liveness verify

Use when a question or a tracked claim is about what the **running** dsh host actually does — a
gate, an event/waterfall site, a service's semantics, or a mechanism such as automatic compaction,
session titling or handoff — where answering from our own plugin's call path, from prose, or from
upstream `main` risks stating a wrong cause. Remote upstream API/field/formula claims stay with
`upstream-source-ground-truth-verify`; this repo's own plugin behaviour is read from `src/` + `lib/`.

## 1. Pin the revision the host actually loaded

- Read `dsh --version` fresh. Both the desktop host and the `dsh web` service load the same store
  checkout; the version string is the only stable handle.
- The host source is the store clone it loads:
  `ls -d /nix/store/*-dsh-desktop-<version>/lib/dsh-desktop/repo`.
  Read only — never edit or `git checkout` inside the store.
- Read the source at that revision for every file/line you cite, and say which revision you read.
  Never write a store path, version or hash into memory, a doc or a skill: they rotate on rebuild.

## 2. Read the mechanism's registration and its own gate

In that checkout open `packages/<domain>/<plugin>/src/index.ts` and answer from source:

- where it is registered (`apply()` / constructor / its `_register…` call), and
- whether it is on by default (an `x: config.x ?? true` in its `resolveConfig`) or only reachable
  through config, and which config key would switch it off.

Then read that key in **both** profiles (`~/.dsh/profiles/{web,desktop}/cordis.patch.yml` and their
`package.json`) instead of assuming defaults, and note that a bundle-level patch only inserts rows.

## 3. Read every trigger site, not the happy path

- Agent lifecycle points are dispatched in `packages/core/agent-loop/src/agent.ts`
  (`dispatch.waterfall('agent/pre-step', …)`, `step/end` appended in the run loop) — cite the file
  and line you read.
- Check the pressure path *and* the error path (e.g. `agent/request-error` with the
  `CONTEXT_WINDOW_EXCEEDED_CODE` in `packages/llm/llm/src/error.ts`) before saying when a mechanism
  can fire, and record whether the site is a waterfall (may rewrite the request) or an observation
  (cannot).
- Take measured numbers (snapshot sizes, retry counts, defaults) from the source's own header
  notes or config resolution rather than estimating them.

## 4. "How do I influence a running session?" — read the channel table

`packages/core/agent/src/runtime-types.ts` (with `packages/core/agent-loop/src/runtime-context.ts`) defines the
real options: `systemPrompt.context()` (materialised and retained per text change — not for text
that changes each turn), `Agent.inject` (next pre-step, no wake), `steer` (nearest step,
droppable), `followup` (its own turn, wakes the driver), and returning a rewrite from a waterfall.
Pick the channel from source and state the semantics you rely on.

## 5. Prove the mechanism is live here, from archived session events

A source read only says what *would* happen; add a trace from this machine:

- Discriminate by event shape. Automatic vs manual compaction: a `compaction/start` with a non-null
  `turn` and **no** `sourceCommandId` is the automatic path, while a manual `/compact` carries
  `sourceCommandId` with `turn: null`. Titling: a handoff child shows a single `session/title`
  whose source is `user` (the plugin's own `rename`), while ordinary sessions can show a
  `fallback → provider` upgrade.
- Pair the positive hit with a **negative control** (a session or workspace where the mechanism did
  not run) and report counts as "as of now" — never copy a count into memory or a doc.
- Stay read-only: `.agents/memory/session-logs/**/session.jsonl` (or the rendered `session.md`) and
  `~/.dsh/storages/*.json`; never write the user's live store.

## 6. Close the loop on tracked claims

If a MEMORY.md / CONTEXT.md claim contradicts what you read plus traced, correct that one claim,
verify the document through the plugin API (`loadMemory(root, MAX_MEMORY_CHARS)`,
`isMemoryTruncated(text)`, render round-trip), run `pnpm test`, and commit docs-only with scoped
paths (`git add <paths>`, `git commit -F <msg> -- <paths>`); a doc edit changes no loaded state.
