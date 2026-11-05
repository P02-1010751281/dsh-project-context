---
name: cross-harness-interface-shim-registry
description: "Build or update dsh-project-context's per-host interface registry under docs/harness/ when deciding which dsh/pi/codex surfaces to adopt and which adapters are real shims: inventory each host's own shipped API surface, register adopted and deliberately-unadopted points with stable IDs, and prove a shim's removal blockers before touching src/."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Cross-harness interface and shim registry (`docs/harness/`)

Use when deciding which host surface the four dsh plugins should adopt, when the user asks "is this a shim?" or "can this shim be dropped?", and when a host gains a new event/hook family. The registry is split one file per host; the decisions live in their own file.

## 1. Inventory from the host's own artifacts, never from our call sites
Reconstructing the surface by reading `src/` only yields what we already use, and inverts every conclusion.
- **dsh**: resolve the store checkout the running host actually loaded — read the socket holder's cmdline (the session port, pid from the `LISTEN` row) and take `<store>/lib/dsh-desktop/repo`; never reuse a remembered store path or version. Enumerate `SessionEventMap` plus each package's own `EventMap` there, and count the `session/event` variants separately from the typed events.
- **pi**: read `dist/core/extensions/types.d.ts` of the pinned `pi-coding-agent`; count the `on()` overloads and the public API methods.
- **codex**: read `hooks/hooks.json` *and* confirm the protocol fields against the codex binary itself (`grep -ac` for `hook_event_name`, `additionalContext`, `stop_hook_active`, the context limit field). The JSON alone is a declaration, not behaviour.
- Record the number together with the command that produced it; a count in prose with no command is a claim, not evidence.

## 2. Register adopted AND deliberately-not-adopted surfaces
- One row per surface, stable ID (`DSH-*`, `PI-*`, `CDX-*`), registered before the code changes; IDs are never reused and never renumbered.
- Each row names the owning symbol/path on our side, never a line number — the file is rewritten often.
- Before writing that we "connect" something, grep `src/` for the symbol. A surface that exists upstream but is only mentioned in prose (e.g. `tools/pre-execute`, 0 hits) is registered as **not adopted**; that row is the only thing preventing a later round from reporting it as connected.
- Same file records absences that block porting (a hook family another host has and dsh does not), because that turns "to do" into "no port", which is a different answer.

## 3. Split by owner; keep the cross-cutting part alone
- `docs/harness/README.md` — cross-host semantic comparison, persistence contract, recheck commands, registration protocol.
- `docs/harness/{dsh,pi,codex}.md` — one host each: its state machine, interface table, our integration points.
- `docs/harness/integration.md` — the decisions: adopt / not adopt / shim, with the reason per row.
- Never mix inventory and decision in one file: the decision file must be readable without the inventory, and the inventory must stay free of conclusions.

## 4. Classify a shim by what forced it
- Using a documented option (e.g. `interpolate: false`) or a thin local wrapper over it is **normal use, not debt**; counting it inflates the shim number and buries the real ones.
- A shim is an adapter forced by the host's shape. Adapters that belong to another repo (pi / codex implementations) are not this repo's debt and do not belong in this table.
- Before declaring one removable, prove all three: (a) the package it would import is a *declared* dependency, not merely present in `.pnpm` through a peer; (b) any type augmentation it relies on comes from a package we do declare; (c) the locked version's signature matches the running host's. Any one failing keeps the shim and the row states which one failed.

## 5. Cross-check prose against its own table
Count the decision rows (`接` / `不接`) and the interface rows with `grep -c` before committing, and make every headline number match the rows. A count that disagrees with the table it summarises is the recurring error class of these docs.

## 6. Land it
- Run every recheck command in `README.md` before committing a count that depends on it.
- Commit with explicit paths (`git commit -F <msg> -- <paths>`), since a second agent session may be editing the tree.
- If `.agents/memory/*` was updated in the same round, verify with `roundtrip.mjs` / `share-fit.mjs` and `loadMemory` + `isMemoryTruncated` before staging.
- Docs-only round: no rebuild, no host restart, no `src/` change.
