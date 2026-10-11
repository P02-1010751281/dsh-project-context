# Batch Q evidence — the opaque reply acceptance face (2026-10-10)

Read-only, 30-second probe for the defect the ninth pi triage pass recorded as **batch Q**: dsh's
`fallback-opaque` path publishes the model's raw text as `MEMORY.md`, and its only guard is the
body-less-skeleton test, so a conversational reply replaces the whole stored memory silently.

Run from the repo root (anything else works too; the script resolves the root from its own path):

```sh
node .agents/evidence/2026-10-10-opaque-reply-acceptance/probe.mjs
```

It imports the **built** `lib/` (so it judges what the host loads, not `src/`) and, in section 3, drives
`consolidateProject` against a throwaway root created with `mkdtemp` under `$TMPDIR` — the repo's own
`.agents/memory/MEMORY.md` is never written.

## Expected output before batch Q (HEAD `2e3e4a6`) — exit 10

```text
=== 1. the gate only sees a body-less skeleton ===
  field opener (118 bytes) isHeadingOnly=false sections=undefined
  prose + one bullet       isHeadingOnly=false sections=undefined
  heading-only skeleton    isHeadingOnly=true  sections=PARSED
  headingless prose        isHeadingOnly=false sections=undefined

=== 2. sectionsFromMarkdown acceptance table ===
  good               ACCEPT
  setext             REJECT(undefined)
  html heading       REJECT(undefined)
  star bullet        REJECT(undefined)
  numbered           REJECT(undefined)
  indented entry     REJECT(undefined)
  unknown section    REJECT(undefined)
  prose line         REJECT(undefined)
  no title           ACCEPT
  fenced body block  REJECT(undefined)
  CRLF               ACCEPT

=== 3. end-to-end: does the reply reach the write? ===
  [field-opener (pi's incident shape)] status=updated memoryWritten=true stored byte-identical=false
    MEMORY.md now: "# Project Memory\n\nI'll review the frozen revision and record the durable lessons now.\n"
  [prose + one bullet] status=updated memoryWritten=true stored byte-identical=false
    MEMORY.md now: "# Project Memory\n\nI'll do the following:\n- review\n"
  [heading-only skeleton] status=updated memoryWritten=false stored byte-identical=true
    MEMORY.md now: "# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i1\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n"

=== verdict ===
  DEFECT PRESENT: a prose reply replaced the stored memory; only the bare skeleton was kept.
```

Exit code **10** means DEFECT PRESENT; **0** means the defect is closed. After a batch Q port the expected
shape is: the field opener and the prose-plus-bullet reply are both refused (`memoryWritten=false`,
`stored byte-identical=true`, one diagnostic in `errors.log`), while a reply dsh can read
(`sectionsFromMarkdown` parses it, or the tool-call path) still lands — so this probe must be re-read,
not deleted, when Q lands.

## Expected output after batch Q (2026-10-11) — exit 0

Only section 3 moves; sections 1 and 2 are unchanged (the shape gate is a new predicate beside
`isHeadingOnlyDocument`, which deliberately still calls a prose wrapper content).

```text
=== 3. end-to-end: does the reply reach the write? ===
  [field-opener (pi's incident shape)] status=updated memoryWritten=false stored byte-identical=true
    MEMORY.md now: "# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i1\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n"
  [prose + one bullet] status=updated memoryWritten=false stored byte-identical=true
    MEMORY.md now: "# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i1\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n"
  [heading-only skeleton] status=updated memoryWritten=false stored byte-identical=true
    MEMORY.md now: "# Project Memory\n\n## Project\n- p1\n\n## Invariants\n- i1\n\n## Pitfalls\n- q1\n\n## Index\n- x1\n"

=== verdict ===
  DEFECT CLOSED: prose replies no longer replace the stored memory.
```

The two prose replies are refused by the **shape** gate (`isConversationalOpaque`: not this extension's
document shape, at least the floor long, aimed at a store that already holds one), not by the cap — the
same run's `errors.log` carries `the consolidation reply was not a writable memory document; the stored
memory was kept unchanged`, and its status stays `updated` because the context half still landed. The
probe's fixture store (`# Project Memory\n\n## Project\n- p1\n…`) is a four-section document, so
`storedIsDocument` is true. Spec, deliberate costs and residuals: `docs/batch-q-document-shape-brief.md`;
the mutation round that keeps this pinned is in `CHANGELOG.md` under 未发布.

## The refused case has a user-visible half too — `receipt-probe.mjs`

A refusal that only leaves an `errors.log` line is a silent no-op from the outside, so the deliberate-cost
case is driven end to end through the receipt as well:

```sh
node .agents/evidence/2026-10-10-opaque-reply-acceptance/receipt-probe.mjs
```

Fixture: a *free-form* store (title + column-0 bullets, no `## <section>`) rewritten by the model in exactly
the same free-form shape, which batch Q refuses (the store is a document, the reply is not this extension's
shape). Expected output — `RESULT: PASS`, exit 0:

```text
  status=updated memoryWritten=false contextWritten=true
  receipt: "Memory: updated CONTEXT.md."
  stored byte-identical=true diagnostics=1
    [memory] the consolidation reply was not a writable memory document; the stored memory was kept unchanged
```

The receipt names **only** the file that landed (`CONTEXT.md`) and never claims a memory write, and the
single diagnostic names the shape — not the cap — as the reason. Before batch Q the same fixture reports
`memoryWritten=true` and replaces the store.

## What each section proves

1. **The guard is one-sided.** `isHeadingOnlyDocument` returns false for anything whose non-heading lines
   carry a letter or digit (`CONTENT_RE = /[\p{L}\p{N}]/u`), so prose counts as content. dsh pins that
   deliberately: `test/sections.test.mjs:344-350` asserts a prose wrapper is *not* heading-only, and
   `src/project-memory/sections.ts:284-292` records the boundary as accepted rather than closed.
2. **The parser is already strict** — `sectionsFromMarkdown` takes only the plain four-section `- `
   document (one optional `# Project Memory` title, `## <known section>` at column 0, `- ` entries at
   column 0, all four sections, wrapped-fence and trailing-marker stripped). That strictness is what
   routes everything else into the opaque path, which is why the opaque guard decides.
3. **The write lands.** `src/shared/reply-json.ts:116` turns a non-JSON reply into `{memory: text}`, the
   parse falls through to `kind="fallback-opaque"` (`consolidate.ts:360`), the opaque half of
   `replyIsSemanticallyEmpty` asks only `isHeadingOnlyDocument` (`consolidate.ts:374`), and the write path
   accepts any change of at least 40 characters (`index.ts:198`). Tier C never intervenes: an opaque reply
   has no sections, so `writeCapDroppedChars` is 0 and no retry or refusal fires.

## Boundary

This proves reachability, not field frequency: no live dsh incident is recorded, so practical severity is
unmeasured. The sectioned (non-opaque) path is covered here only for the skeleton case. The port shape,
the deliberate refusals it costs and the decision it needs are in `docs/upstream-pi-triage.md`, ninth
pass, batch Q.
