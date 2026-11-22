---
name: dsh-core-host-boundary-port
description: "Move dsh-project-context host interfaces behind the single-door boundary in src/host/ (or port one more plugin onto the HostContext façade): port the port shape per plugin, extend the boundary gate with a failing fixture in the same commit, mutation-check it, rebuild lib/, split the commits, then hand the restart-gated activation to the user."
derived_from: autolearn
evidence: ["session-6a120da1-d436-4c96-9fcd-626d6ac374db", "session-574c148f-4117-4268-abe8-85ce5b0cb739"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Port a host interface behind the core/host boundary

Use when dsh-project-context must stop naming `@deepseek-ai/*` outside one door (phase 2b/2c of
`docs/core-host-boundary.md`), or when another plugin's core still receives the raw cordis `Context`.
This is a code + gate + docs batch, never a runtime verification: the resident host keeps running the
pinned build until the user bumps the pin and restarts.

## 1. Read the current state before planning

```bash
git log -1 --oneline; git status --short; git rev-parse HEAD origin/main
sed -n '1,200p' docs/core-host-boundary.md     # phases, phase-2 triggers, client/ exception
sed -n '1,140p' scripts/check-boundary.mjs     # the gate you are about to extend
ls src/host src/host/dsh
```

Also read the rule text (`RULES.md` 4.6 + 6.1) and the dependency whitelist in
`docs/architecture.md` §2 by name, not by line number. The target shape, unchanged since it landed:

```
src/host/contract.ts        the only public face the cores import; declares interfaces, ZERO @deepseek-ai imports
src/host/dsh/types.ts       harness adapter: adds the harness types, closes open vocabularies via `declare module` on
                            the host's own ContentBlockMap / SessionEventMap (never a frozen type list)
src/host/dsh/services.ts    the only `ctx.get(...)` site: narrow typed getters + the `*Like` service interfaces
src/host/dsh/log.ts         ctx.logger   -> logOf(ctx)
src/host/dsh/llm.ts         ctx.llm      -> llmOf(ctx) (own reply-chunk union; bad mapping is loud, never faked)
src/host/dsh/lifecycle.ts   ctx.effect   -> onDispose(ctx, …)
src/host/dsh/host-context.ts hostContextOf(ctx) -> HostContext (on / registerCommand / addPromptContext / onDispose / log / services)
src/<plugin>/index.ts       the only file allowed ctx.on / ctx.commands / ctx.systemPrompt / hostContextOf(
src/<plugin>/<core>.ts      start(host) — no cordis types, registration only through host.*
```
dependencies point one way: entry → core → host; nothing under `src/host/` may import a core or
`shared` module. `client/` is out of gate scope by design.

## 2. Port one plugin per increment

- Entry keeps its `apply()` and becomes pure wiring (a few dozen lines); move the registration and
  command bodies into a core module that takes `HostContext`.
- Keep every host call's arguments and ordering identical — the façade forwards, it does not wrap.
- Add the compile-time mapping proof next to the adapter: a `ListenerFits` table forcing each
  contract listener to be assignable to the host event of that name, and identity functions pinning
  the command and prompt shapes. A host payload change must break `tsc`, not a core at runtime.
- Watch for name collisions the compiler cannot see: replacing a local wrapper with a same-named
  import produced `return projectionsOf(ctx)` self-recursion with `tsc` green. After any rename, read
  the call site's semantics, not just the type errors.
- Audit each predicate against the shipped harness source, not against our call path: a differential
  predicate run against the built adapter caught a missing `SURFACE_EVENT_TYPES.has(type)` half and a
  `Session.ownEvents()` cast read that bypassed the view.

## 3. Extend the gate in the same breath as the code

For each new rule, edit both halves and keep them in one commit:

1. `scripts/check-boundary.mjs`: add the regex/condition and a `fail("<rule>", …)` with a message that
   names the offending file and the allowed home.
2. `test/host-boundary.test.mjs`: keep the repository-passes case, add a failing fixture for the new
   rule, and add the permitted direction (e.g. `index.ts` may register, `src/host/<harness>/` may name
   a host package) so the rule cannot be tightened into a blanket ban.

```bash
pnpm boundary:check      # expect "N source file(s), 0 failure(s)" and exit 0
node --test test/host-boundary.test.mjs
```

Then mutation-check: revert the new branch (or make the condition inert), prove the exact named test
 goes red and the rest stay green, restore `src/` from a hashed copy, rebuild, and confirm zero
markers. A mutant that does not compile or is behaviourally equivalent is not evidence.

## 4. Gates, in this order

```bash
pnpm typecheck           # tsc --noEmit + tsc -p tsconfig.client.json --noEmit
pnpm boundary:check
pnpm test                # tsc, client typecheck, node --test 'test/**/*.test.mjs'
pnpm docs:check          # only when tracked docs changed
pnpm build               # regenerates lib/ (tracked) — commit it with the code
```

`lib/` is tracked, so a batch that touches `src/` or `client/` must carry the rebuilt `lib/`; run the
build twice and require the second run to leave `lib/` byte-identical. Quote the real output counts
and exit codes in the report; never a remembered number.

## 5. Documentation and commits

- `RULES.md` 4.6 states the boundary and 6.1 requires `pnpm boundary:check` for any `src/` change; the
  3.2 large-file baseline moves when a module splits — read the line count, do not restate it.
- `docs/architecture.md` §2 whitelist and `docs/core-host-boundary.md` (layers, rules, phases,
  phase-2 triggers, the `client/` exception) carry the narrative; `CHANGELOG.md` 未发布 gets the batch
  entry with the real test names.
- Anchors are `path:line` + symbol name; a citation pointing at a call line instead of the definition
  fails `pnpm docs:check` — fix the anchor, never loosen the gate.
- Split the batch so each commit is one intent: `feat(host): …` (`src/`, `lib/`, `scripts/`, `test/`),
  `docs(rules): …` (RULES + CHANGELOG 未发布 only), `docs: …` (spec/architecture), `docs(memory): …`
  (`.agents/memory` snapshot last). Stage explicit paths — never `git add -A` — and pass paths to
  `git commit -F <msg> -- <paths>` because another agent may share the tree.

## 6. Push, then hand the activation over

The resident host is not this tree. Even after a green batch and a push the loaded plugin code is the
pinned build, so:

- prove reachability first (`git ls-remote origin`), push, then require `git rev-parse HEAD` ==
  `git rev-parse origin/main`; a 128/`Connection closed` on push or on the very next `ls-remote` is a
  transport flake, not a lost commit — re-check reachability and retry.
- say plainly in the report that activation is user-only: pin bump (desktop/web `git+ssh://…#<sha>`,
  ctxdev `link:`) plus host restart plus tab hard-reload for `client/`. Do not restart the host
  yourself and do not claim the change is live.
- register what the port deliberately leaves for later (the 2d direction mismatches hidden by
  `as unknown as` in `llm.ts` and by the generic service getter) as evidence, not as done.

## Evidence layout

Freeze each round's predicates, differentials and mutation log under
`.agents/evidence/<date>-<subject>/` (example: `2026-11-22-host-contract-audit/`) and point the commit
message and the spec at it.
