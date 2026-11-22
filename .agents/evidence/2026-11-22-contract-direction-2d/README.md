# Phase 2d decision input: the two direction mismatches

Status: decision input only. Nothing here is implemented; `src/` is at `967d0c7`.

The 2b audit (`.agents/evidence/2026-11-22-host-contract-audit/README.md`, Q2) registered two
direction mismatches and deferred them to 2d. This note costs both, so the next increment can start
from verified facts instead of re-deriving them.

## What was verified here

- Upstream brands are **value** exports and identity functions
  (`packages/llm/llm/lib/types/brand.d.ts`: `MessageId`, `ToolCallId`, `ReasoningEffortId`;
  `brand.js` forwards `brandString`). `SessionId` is the same shape in
  `packages/core/session/lib/types/types.d.ts:12`. So an adapter can brand a plain string without a
  cast — this **corrects** the audit, which expected one residual `as` for `sessionId`.
- A user request message can be `RequestUserInput` (`llm/llm/lib/types/types.d.ts:509-514`):
  `{ role: 'user'; content: UserMessage['content']; id?: never; source?: never }`. That shape avoids
  `MessageId` and `MessageSource` entirely. Whether dsh's request path reads `source` is **not**
  verified; do not assume the message half is free.
- The two concealed casts exist where the audit said:
  `src/host/dsh/services.ts:189-190` (`ctx.get("sessionProjections") as SessionProjectionRegistry |
  undefined`) and `src/project-memory/todo.ts:57`
  (`[TODO_PROJECTION_KEY] as unknown as SnapshotKeys`). The core pays for the second one.

## Mismatch 1: outbound request, core → host

`src/host/contract.ts` `GenerateOptions` (core-built) is not assignable to dsh's `GenerateOptions`.
The auditor's compiler witness (rc.5 store tree and the repo floor agree) reports, field by field:

| field | why it fails |
|---|---|
| `reasoningEffort` | contract `string` ↛ host `Branded<'ReasoningEffortId'>` |
| `messages` | contract `readonly UserMessage[]` ↛ host mutable `RequestMessage[]` |
| `sessionId` | contract `string` ↛ host `Branded<'SessionId'>` |
| message `id` | contract `string` ↛ `MessageId` |
| message `source` | contract `MessageSource` ↛ host `MessageSource` |
| `ToolCallBlock.id` | contract `string` ↛ `ToolCallId` |
| `tools` | passes; no mismatch |

Fix shape: an adapter function `toHostRequest(options: GenerateOptions)` in
`src/host/dsh/llm.ts` that builds the host request field by field, using the brand constructors —
no `as`, no `as unknown as`. Cost estimate ~40 lines in one adapter file, one contract narrowing
(`messages`), no test-fake changes (the fakes are `.mjs` and never build a `GenerateOptions`).

Blocking decision: contract `OpaqueBlock` carries only `type`, so an opaque content block cannot be
reconstructed. The producer today sends text only (`src/shared/model-call.ts`), so narrowing
`GenerateOptions.messages` to the text block is the honest option; it removes the contract's
affordance to carry opaque blocks in a request.

## Mismatch 2: projection registry, host → core

Contract `SessionProjectionRegistry.snapshot(session, keys: readonly string[])` is not satisfied by
the real registry: upstream takes `ProjectionKeySelection = readonly (keyof SessionProjectionMap)[] |
ReadonlySet<…>` (`session/session-projection/lib/types/index.d.ts`). Both directions fail, so the
cast at `services.ts:190` is load-bearing, not cosmetic.

Fix shape: the contract declares its own closed key union (the two keys the cores read:
`contextBreakdown`, `todos`); the adapter translates contract key → host key inside `projectionsOf`.
The `contextBreakdown` half can be compiler-checked with
`satisfies Record<ContractKey, keyof SessionProjectionMap>`; the `todos` key is not declared in this
program's map and stays a named string. One documented `Session` identity widening remains in the
adapter (cores only ever hold host `Session` instances).

Cost estimate: ~15 lines across `contract.ts`, `services.ts`, `todo.ts`; two call sites; no test-fake
changes (`test/todo.test.mjs`'s fake ignores its `keys` argument).

Option B (inbound wrappers for every host object) cannot fix mismatch 1 at all and costs 250-400
lines plus per-call allocation; not recommended.

## Runtime observability

Both mismatches are type-level today. Mismatch 1 cannot drop a field: the cast hands over the same
object and every field the host reads is set. Mismatch 2 is the dangerous one: a wrong key yields an
empty `values` and `todoLines(undefined)` returns "no opinion", so the todo lines would be silently
never written. `test/projection-typing.test.mjs` pins the host-typed read, not the contract-typed one.

## Acceptance criterion for "2d closed"

Compiler-visible, runnable on the floor as well as rc.5:

```bash
node_modules/.bin/tsc -p test/fixtures/host-contract
```

Two fixtures in the style of `test/fixtures/projection-typing/`:

- `positive.ts`: `const f = (o: Contract.GenerateOptions): Host.GenerateOptions => toHostRequest(o)`
  and a registry conversion — zero diagnostics.
- `negative.ts`: the same conversions with one field dropped and one key misspelled — exactly two
  `error TS` lines, named in the test.

Secondary, same commit: no `as unknown as` left in `src/host/dsh/llm.ts` or `src/project-memory/todo.ts`,
and `pnpm boundary:check` exit 0 (the adapter will name a second host package).

## Recommended order

1. Delete the three vestigial casts (`src/project-memory/todo.ts:100`,
   `src/shared/model-call.ts:73,204`) — zero-risk, `pnpm typecheck` proves it.
2. Mismatch 2 (smaller, kills the silent-miss class).
3. Mismatch 1 (needs the `messages` narrowing decision first).
4. Repoint a copy of `test/projection-typing` at the contract type so the key check lives on the core
   path again.

## Unverified

- Whether `source` on a request message is read by dsh's adapters (decides if `RequestUserInput` is a
  clean target).
- Whether the `todos` projection is registered in the running host (the auditor did not find a
  declaring package under `repo/packages`; separate question from the typing fix).
