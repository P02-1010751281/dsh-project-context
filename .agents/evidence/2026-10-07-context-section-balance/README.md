# CONTEXT.md per-section share control (2026-10-07)

Read-only probe over the tracked `.agents/memory/CONTEXT.md`, driving the built `lib/` (the code the
host actually loads). It exists because the older round-trip probe cannot see the drift this round
found: `roundtrip.mjs` checks the per-item cap and byte identity, but **not** the per-section share
from `contextSectionBudgets()`. `## Open tasks` reached 99.7% of its share that way — 25 characters
of headroom, longest item 794/800 — with every existing probe green, because
`renderContextDocument` only drops a section's tail once the budget is *already* exceeded. The
failure is therefore silent until the next `/memory update` pass pays for it.

## What it measures

- `renderContextDocument(parsed( stored )) === stored` — the stored document is a fixpoint of the
  renderer, so no content is being renormalized away on each pass.
- the renderer's own truncation marker: `renderContextDocument` appends
  `_[context truncated: N characters dropped]_` whenever a clamp fires (`clipProse`, `clipList`'s
  per-item trim, the entry cap, or the section-budget drop).
- a **cross-check**: the script derives its own dropped-character count from the parsed content and
  requires it to equal the number the renderer reports. A formula drift here can therefore not
  silently mis-report headroom.
- per section: characters the section *wants* to hold against its `contextSectionBudgets()` share
  (`Summary` prose, `Key points` / `Open tasks` lists through the same trim, entry-cap and
  trailing-drop shape as `clipList`), printed as a percentage plus absolute headroom.

## Exit semantics

`exit 0` requires all of: byte-identical round trip, nothing clipped (no marker), and every section
at most `MAX_SECTION_FILL` (90%, the same prompt-target convention the MEMORY sections use) of its
own share. A section between 90% and 100% is already red — that is the point: it is still lossless
but one bullet away from dropping its tail. Over 100% additionally means the renderer is clipping.

## Controls

```bash
bash .agents/evidence/2026-10-07-context-section-balance/control.sh
```

Three cases, all on copies in a temp dir (the tracked document is never padded):

| case | expectation | what it proves |
|---|---|---|
| tracked `CONTEXT.md` | `exit 0` | the live document passes |
| padded to ~92% of Open tasks' share | `exit 1`, still `byte-identical: true` | the **preventive** gate fires with no clip and no marker — the exact state that was previously invisible |
| padded past Open tasks' budget | `exit 1` | the loss path is reachable; the renderer starts dropping trailing items |

`control.sh` deliberately does not use `set -e`: the commands under test are expected to exit
non-zero and the script branches on the code.

## Run

```bash
node .agents/evidence/2026-10-07-context-section-balance/measure.mjs
```

## Why a separate probe rather than an edit to `roundtrip.mjs`

`roundtrip.mjs` answers one question (is this document still a fixpoint, and is every item inside
the 800-character cap); this one answers a different question (is every section inside its own
share, with room to spare). Keeping them separate keeps each claim checkable on its own. Re-run both
after any hand edit to `CONTEXT.md`.
