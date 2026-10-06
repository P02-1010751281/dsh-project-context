---
name: dsh-memory-budget-fit-offline-verify
description: "Pre-flight the memory/context write path of dsh-project-context offline: drive the built lib/ renderers, section budgets and fitMemoryInput against the real .agents/memory documents to tell a section-budget refusal from a model-output clip, and record the probe as evidence before the user's host restart."
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Offline budget-fit verification of the memory/context docs

## When to use
- A memory-layer pass (`/memory update`, a consolidation, a CONTEXT.md carry) refused, was clipped, or is about to run, and the desktop host on `127.0.0.1:19387` still runs code older than your last `src/` commit — so the live pass cannot be observed yet and the restart is user-only.
- You must decide *which half* of the write path bites before choosing a fix (shrink the document vs raise a cap).

Scope: this proves the code path over the **real** stored documents. It never proves what a live `/memory update` will do; that needs the user's restart.

## 0. Prove the probe runs against the code the host loads
```bash
ss -ltnp | grep 19387            # holder pid
ps -o lstart= -p <pid>           # start later than the last src/ commit = loaded
# (no pid/start time is ever written down)
git log -1 --format=%cI -- src/
git diff --exit-code -- lib      # empty after a build = lib/ matches src/
```
Probe `lib/...` — the host loads the built output — never `src/...`. If the holder started before the last `src/` commit, say so in the record: the live half is still pending.

## 1. Read the budgets from the built module, never from notes
```bash
grep -n "memorySectionBudgets\|MEMORY_SECTION_PROMPT_SHARE" lib/project-memory/memory-schema.js
grep -n "isContextTruncated\|renderContextDocument" lib/project-memory/*.js
grep -n "export function fitMemoryInput" lib/project-memory/*.js
```
Import them by file path in a small `node` script and print the values at the current cap. Shares, prompt share, per-item caps, configured `maxTokens` and the model ceiling are configuration — read them fresh, never record them.

## 2. Occupancy and render round trip on the real MEMORY.md
- Per section, sum `entry text + the bullet overhead the renderer adds` and compare against `memorySectionBudgets(cap)` (hard budget) and against the prompt budgets (the prompt share applied to each).
- Run `sectionsFromMarkdown(<the real document>)` → `renderMemoryDocument(...)` and require: `sectionDropped 0`, `droppedItems 0`, `itemTruncated 0`, and a **byte-identical round trip**.
- `sectionDropped`/`droppedItems` > 0 means the budget half is live: the pass ends `lossy-refused`, nothing is written, and raising a character cap will not help.

## 3. The output-fit half
- Call `fitMemoryInput(...)` with the real MEMORY.md and CONTEXT.md and print the requested `maxTokens` plus the `clipped` flag and the hidden memory/context counts for at least: non-reasoning, reasoning with adapter cap unknown, reasoning with a low adapter cap, reasoning with a high cap.
- `clipped true` is the output half. It grows with the document (hidden thinking is charged there too), so a larger document is the cause and shrinking the document is the durable fix.

## 4. CONTEXT.md's own budget
- Run the context schema's check (the module exporting `isContextTruncated`) over the real CONTEXT.md and print each section's chars against its cap with an over/under flag; require not truncated and every section inside budget before a restart.

## 5. Classify a past failure from the pass's own log
```bash
tail -n 20 .agents/memory/errors.log
```
- `N section(s) exceeded their budget ... whole entry(ies) would have been dropped` → budget half.
- `cut off by the model output limit` → output half.
- `1 entry(ies) exceeded their section's per-item cap` → per-item truncation, which retries but never refuses (not a reason to shrink the document).

## 6. Record it, then hand the live half off
- `.agents/evidence/<YYYY-MM-DD>-<topic>/{README.md,*.mjs}`: the README states the claim, the exact command, the observed output and the revision read; the script must print the inputs it read (at least both document lengths) so a re-run can tell which input moved. Make it self-verifying in the same commit, not a follow-up.
- Docs-only commit with explicit paths (`git commit -F <msg> -- <paths>`), push, then confirm `git rev-parse HEAD` equals `git rev-parse origin/main`. A docs-only round leaves the restart criterion (holder start vs last `src/` commit) unchanged; a `src/` change moves it.
- Add the probe, the residual unknowns and the exact post-restart command to `.agents/memory/CONTEXT.md`, and state plainly which half of the pass is still unproven.
