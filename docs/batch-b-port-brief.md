# Batch B port brief — `record_memory`: structured sections through a tool

**Status: ported 2026-10-04**, in five scoped commits (`022dd27`, `1e43236`, `e69b29f`, `438d518`,
`11a1a43`). This file is kept as the brief that was written for the batch; the outcome and the
deliberate deviations are recorded in `docs/upstream-pi-triage.md` §"Third pass" (batch B) and in the
unreleased section of `CHANGELOG.md`. Batches A (`986485d`), C (`aa62699`) and D (`3b672bd`) of the
third pi triage pass preceded it. The one item left open is migrating this repo's own free-form
`MEMORY.md` to the four-section format, which has to happen against the live new code (a desktop
restart); see `CONTEXT.md`.

## 1. Why this needs its own session

pi's `a562d7e` is **33 files / ~2180 insertions**, and unlike A/C/D it is not a behaviour fix on an
existing seam: it changes how consolidation output is produced (a tool instead of a JSON reply),
**what MEMORY.md is** (per-section entries instead of one opaque Markdown document), and **what
commands exist** (three renames, one removal). Two of those three are user-visible and one migrates
this repo's own memory document. A half-landed version is worse than none.

## 2. The pi reference (verified at `6707376`)

| pi path | what it carries |
|---|---|
| `memory/sections.ts` (385 lines, new) | the `record_memory` tool schema, the section-entry model and the renderer that turns entries into the stored document |
| `memory/schema.ts` (46 lines) | `MEMORY_SECTIONS` = Project 0.2 / Invariants 0.4 / Pitfalls 0.25 / Index 0.15, plus `memorySchemaOverheadChars()` |
| `memory/context-schema.ts` (+24) | `CONTEXT_TOOL_SCHEMA` for the tool's `context` member |
| `memory/pass.ts` (+242) | prefer the tool call, keep the Markdown/JSON extractor as the fallback, refuse an opaque reply that carries no body ("a headings-only skeleton must never replace a stored memory with nothing") |
| `memory/report.ts` (+174) | receipts for the tool path |
| `autolearn/{parse,pass,prompt,schema}.ts` | the same plumbing for `record_skill` |
| `shared/{complete,llm}.ts` | the tool-call plumbing |
| `index.ts` (+29) | registration |
| BREAKING | `/memory-learn`→`/memory update`, `/auto-handoff`→`/handoff`, **`/context-update` removed with no alias and no transition period** |

`MEMORY_SECTIONS` was introduced **inside this range** (`a3f8370`), so dsh's free-form memory document
is not "behind" a fix — there has never been a memory-section schema here. Verify with
`git -C /mnt/Data/Projects/pi-project-context log --oneline -S MEMORY_SECTIONS -- extensions/project-context/memory/schema.ts`.

## 3. Feasibility in dsh — already verified, do not re-derive

The tool path exists; today the plugin just does not use it.

- `GenerateOptions` has `tools?: ToolSchema[]` and `ToolSchema = { name, description, parameters }`
  (`packages/llm/llm/src/types.ts`, dsh 0.2.0-rc.2). `src/shared/model-call.ts` passes **no** tools.
- `StreamChunk` includes `tool-call-delta { index, id, name?, argumentsDelta }` and
  `block-end { index, block }` (assembled `ContentBlock`); finish-reason kinds include `tool-calls`.
  `requestPluginTextWithMeta`'s loop only reads `text-delta`/`usage`/`finish`, so tool chunks are
  dropped today — that loop is the wiring point.
- `makeStrictJsonSchema` is **pi-SDK-side**; dsh exports no equivalent. Build the schema strict by
  construction (every property required, `additionalProperties: false`) — pi's own comment says why
  (an optional property would be wrapped into `anyOf: [<prop>, {type:"null"}]` and forced back into
  `required`, which strict mode rejects).
- `toolHistory` can be omitted for a one-shot call: omission sends the complete declarations.

**This repo's most expensive lesson applies here**: check what the harness already exposes before
declaring a seam (2026-10-02). The tool surface is exposed; the missing piece is our own plumbing.

## 4. Decisions the owner of batch B must get from the user first

1. **MEMORY.md format.** Adopting pi's structured rendering means migrating the memory document to
   the four budgeted sections — including **this repo's own `.agents/memory/MEMORY.md`** (currently
   free-form, 13 `##` sections) and every other project's. It interacts with the cap machinery
   (`MAX_MEMORY_CHARS`, `normalizeMemoryDocument`, the truncation marker) and with the standing
   instruction to keep this repo's memory under the cap.
2. **Command surface.** dsh has `/context-update` (registered in `src/project-memory/index.ts`,
   referenced by `client/locales.ts` hints). pi deleted it outright. Keep (optionally aliased),
   rename, or drop — a product decision, not a port detail.
3. **Scope of the tool.** pi wired both `record_memory` and `record_skill` in the same change.
   Decide whether autolearn comes along or stays on the JSON reply.

If (1) is answered "no", the tractable half is: the tool carries `context` only and MEMORY.md stays
free-form — smaller, but it gives up the point of the batch ("the schema no longer has to guarantee
the character cap").

## 5. Recommended work order

1. **Probe first** (throwaway under `/tmp`, import host modules by absolute path): one call through
   the plugin's request path with a trivial tool, asserting that a `tool-call-delta` arrives, that
   `block-end` carries the assembled call, and what the finish reason is. File the transcript under
   `.agents/evidence/<date>-record-memory-tool-probe/`. No source edit before this.
2. `src/shared/model-call.ts`: accept `tools`, collect tool calls into `CompletionOutcome`, keep the
   text/finish behaviour byte-identical for callers that pass no tools.
3. `src/shared/reply-json.ts`: keep `parseConsolidation` as the fallback; add the tool-arguments
   decoder next to it, so both paths produce the same `ConsolidationResult`.
4. Memory sections: schema + renderer (only under decision 1); `context` already has a table
   (`src/project-memory/context-schema.ts`) — the tool's `context` member should reuse it rather than
   restate the layout.
5. Prompt: prefer the tool, keep the JSON fallback wording, and keep every bound stated in characters
   (batch C's rule).
6. Tests, mutation round, gate, scoped commits, then the triage doc + `CHANGELOG.md`.

## 6. Acceptance criteria

- `pnpm typecheck` 0, `pnpm build` 0, `pnpm test` 0 fail with the new cases counted, `lib/` mutant
  markers 0 (`lib/client.js` size noted if client code moved).
- Every new pin is mutation-checked with the standalone procedure: mutant compiles, its marker
  reaches `lib/`, it changes behaviour, and it turns exactly its own case red.
- No receipt claims a write that did not happen (batch D's rule).
- A headings-only or body-less reply never replaces a stored memory.
- `docs/upstream-pi-triage.md` + `CHANGELOG.md` unreleased section updated; scoped commits only.

## 7. Traps already paid for — do not re-pay

- dsh's finish reason for a cut reply is **`max-tokens`**, pi's is `length`; copying pi's string
  silently disables the retry path.
- Do not touch the `isTopLevel` gates, and leave handoff's `retireIfPending` before its gate.
- `.agents/memory/MEMORY.md` sits at the cap: measure with `loadMemory(root, 32000)` +
  `isMemoryTruncated(doc.text)`, never with `wc -c` or a grep for the marker. A format migration that
  grows the document is silently truncated on the next plugin write.
- A new config key costs **six** edits (config, settings, `client/card-fields.ts`,
  `client/locales.ts` ×2 languages, the consumer) and `test/settings-form.test.mjs` fails if the card
  and the schema disagree.
- Stage exactly this task's paths (`git add <paths>`, `git commit -F <msg> -- <paths>`); never
  `git add -A`. A second dsh session may be editing this repo — see the concurrent-writer guard
  skill, including its untracked-skill check.
- Edit `src/` only in a mutation round; `lib/` is regenerated, and restoring `src/` does not restore
  `lib/`.
- This repo's tests are `node:test` files under `test/` importing `../lib/...`; pi's
  `tests/harness.mjs` does not exist here, so pi's test bodies must be re-expressed against dsh's
  seams (as A/C/D did).
