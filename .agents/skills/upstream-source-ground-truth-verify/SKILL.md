---
name: upstream-source-ground-truth-verify
description: "Verify an external API, field, or formula claim (dsh core, pi, codex-rs) by sparse-cloning and reading the upstream source at a stated revision before changing dsh-project-context code."
---

Use this whenever a change depends on how another codebase actually behaves: model metadata fields, finish reasons, config keys, service contracts, arithmetic/threshold formulas, or an "upstream already does X" claim.

1. Do not fetch pages. web_fetch on github.com, raw.githubusercontent.com and stackoverflow.com returns only search snippets on this host, so it is not evidence. git clone works from this host.
2. Clone read-only into /tmp: `git clone --depth 1 --filter=blob:none --sparse <url> /tmp/<name>` then `git -C /tmp/<name> sparse-checkout set <paths>`. Keep the copy only as long as the question is open; delete it afterwards.
3. For a local sibling checkout (e.g. /mnt/Data/Projects/pi-project-context) run `git fetch` first, compare `HEAD` with `origin/<branch>`, and state the revision actually read. An empty grep is evidence about that revision only, never about the project in general.
4. Read the file that owns the behaviour and quote the exact shape: a field list, an `or` chain over window fields followed by a same-base `min`, a resolver with several `undefined` exits, a constant set. Do not infer from this repo's call site and do not paraphrase blog prose.
5. Decide whether the gap is dsh core or this plugin before writing code. `LlmResolvedModelInfo.context` carrying only `{ contextWindow }`, and `discovery.ts`'s first-match-wins `capacity()` over the five gateway spellings, are core: leave a named seam such as `qualityLimit(window, upstream?)`, pass nothing until core exposes the field, and route the request upstream instead of fabricating the absent value locally.
6. Re-verify the file path and line of any finding before acting on it; a report whose metadata is wrong must not be cited as-is.
7. Keep the verification read-only and hand the result (pinned revision + file paths + quoted shape) to the change/port workflow rather than editing while verifying.
8. Persist only the durable outcome in project memory: revision, file path, and the arithmetic or contract shape.
