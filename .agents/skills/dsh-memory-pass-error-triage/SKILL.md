---
name: dsh-memory-pass-error-triage
description: "Triage a `[memory]` line in dsh-project-context's .agents/memory/errors.log: decide new defect vs known residual vs old-instance noise, prove from the journal whether that pass wrote anything, map the error code/message to the gate or model-call path that raised it, and close a retry gap only through the single caller's `ToolsFallbackOptions.extraCodes`."
derived_from: autolearn
evidence: ["session-e24b9d97-6793-4872-bd69-eeb0e8302fc9", "session-95164f99-376c-4a3c-a9ff-1e48e53310ea"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Memory-pass error triage (`dsh-project-context`)

## When to use

A `[memory]` line shows up in `.agents/memory/errors.log` — during a `/memory` or `/memory update`
receipt, a post-restart acceptance pass, or a handoff — and the question is: is this a new defect, a
known-accepted residual, or old-instance noise, and did that pass write anything? Run every command
from the project root; `errors.log` and `memory.jsonl` are local-only (never committed).

## 1. Read the log with a line-leading anchor

```bash
grep -n ' \[memory\] ' .agents/memory/errors.log | tail -40
```

- Never compare whole lines against a timestamp: continuation lines of a stack trace start with `{`
  or whitespace and sort after `2026…`, so they look newer and hide the real error. Match a
  line-leading timestamp (`grep -n '^20[0-9][0-9]-…Z \[memory\]'`).
- Count occurrences in the file itself, never in your session log (the log echoes your own command
  output, so `grep -c` mostly counts the probe). For a "is this new?" claim list the timestamps and
  their spread: `grep -n 'MALFORMED_RESPONSE' .agents/memory/errors.log`.
- Attribute timing before judging: `[memory] … cannot get required service "llm" in inactive context`
  a second or two before a host start is the previous instance's dispose-time cleanup, not a defect;
  likewise a cap-loss line dated just before a restart was written by the old code under the old cap.

## 2. Prove from the journal whether the pass landed anything

```bash
tail -c 400 .agents/memory/memory.jsonl          # last record: {"ts":…,"op":"replace","text":…}
python3 -c "import json;print(len(json.load(open('.agents/memory/memory.jsonl')) and open('.agents/memory/memory.jsonl').read()))"  # or just read the last line's ts
```

Each write appends one record; `text` is the document as written, so its length is the landed size.
If the journal's last `ts` predates the failure line, that pass wrote nothing at all — say that,
instead of inferring "nothing written" from the message text or from `MEMORY.md`'s mtime alone.

## 3. Map the signature to the gate that raised it (read `src/`, never infer)

| line in `errors.log` | what raised it |
|---|---|
| `cannot get required service "llm" in inactive context` | dispose of the previous host instance; clusters at every shutdown |
| `adopted an externally edited MEMORY.md into the memory journal` | a hand edit adopted by the next pass; expected |
| `memory regression: N … no longer present` | the rewrite-loss report — report-only, not a refusal |
| `plugin model call failed (CODE)` | `src/shared/model-call.ts`; see below |
| `lossy-refused`, `cut off by the model output limit`, `fit-capped-refused` | budget refusals (offline fit path), not model-call failures |

For `plugin model call failed (CODE)` read `src/shared/model-call.ts`:

- `REQUEST_SHAPE_CODES` (`INVALID_REQUEST` / `HTTP_400` / `HTTP_413`) spends the one-shot tools-free
  retry through `callWithToolsFallback` (sticky per pass, `toolsAttempted` set before the call).
- `MALFORMED_RESPONSE` (an unusable `record_memory` tool-call argument JSON, also raised for invalid
  SSE JSON) is *outside* that set; only the memory pass opts it in via
  `ToolsFallbackOptions.extraCodes`, and autolearn must stay at 0 hits on it. The retry keeps the same
  input, session, effort and token budget and only drops `tools`, so the four-section Markdown path
  can still land the pass.
- A truncation failure is `finish === "max-tokens"` or an empty finish; that has its own retry.

Rule out the cap before blaming the model: read the live limit
(`grep -n maxMemoryChars ~/.dsh/profiles/<serving-profile>/cordis.patch.yml`; the platform settings
card may have rewritten it) and look at where the JSON parse broke — an error at a character position
near the head is a malformed generation, not a tail truncation by an output cap.

## 4. State the verdict in three parts

1. new vs known (datestamps in `errors.log`, not a count from a session log);
2. safe vs lossy (journal `ts` unchanged ⇒ nothing landed; a refusal also releases the version claim);
3. fixed vs not (does an allow-set or a test actually cover the branch).

Never upgrade "the wiring is in place" into "the retry fires": a source-string assertion plus a
behavioural call of the fallback proves the branch is reachable, not that it fired live. If no natural
failure occurred after the restart, report that half as UNOBSERVABLE and leave it as a residual.

## 5. Fixing a retry gap

- Extend `ToolsFallbackOptions.extraCodes` at the single caller only; leave the shared allow-set and
  the autolearn policy untouched, and keep `toolsDisabled` / `toolsAttempted` sticky semantics.
- Add a positive test (the crafted code spends the retry) and a negative control (another unusable code
  still fails), mutation-check both, then `pnpm build` (or `pnpm test`, which runs `tsc` + `node --test`)
  and commit `lib/` with `src/`.
- Record the batch under `### 未发布` in `CHANGELOG.md` with the observation count, the ruling, and what
  stayed a residual.

## Traps

- A green suite does not prove the live branch: if both profiles set a value the code guards on, that
  branch is never exercised in production — add a case that reaches it.
- `errors.log` cannot serve as an acceptance signal for a feature (a zero-line count coexists with
  many real uses); use it for failures only.
- Do not grep a file you just appended to and report the count as evidence.
