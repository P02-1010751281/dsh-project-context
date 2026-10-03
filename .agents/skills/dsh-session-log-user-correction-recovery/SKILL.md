---
name: dsh-session-log-user-correction-recovery
description: "Recover a user's own earlier corrections and decisions from the archived dsh session logs when project memory or CONTEXT.md contradicts them, instead of re-arguing from memory."
---

<!-- evidence: session-8256f99d-d42b-4cac-8e6e-798346d0fbf9 — the session holding the buried corrections — plus session-9bdf608c-db82-4331-8a8d-b92f178736e8, which executed the recovery end to end: the user's own turn at 2026-09-25 10:55 「我怎么觉得不对呢？你翻一下以前的session，我矫正过好几遍了」, the revert of the wrongly-directed commit at 11:04, and the corrected fix at 11:10. A recurring failure mode in this project: memory recorded a user-corrected decision backwards and the regression was only recoverable by parsing user/message events out of the archived session logs. The procedure is concrete and repeatable (log location, source.kind filter, the banner exception, git cross-check). These two ids are two stages of ONE incident; a **second independent incident** was found on 2026-10-03 (see the re-evaluation note below), so the promotion bar is met and only the user's confirmation is pending. -->

<!-- merged 2026-09-26: this file absorbed `dsh-user-correction-recovery.md`, which the autolearn pass had stored
     under a second name for the same procedure (candidate dedupe compares the exact `name` only — see the
     `existing.has(skill.name)` and `candidateExists` branches of `rejectionReason` in
     `src/project-autolearn/candidate.ts`; no line numbers, they drift). That file's "Traps" block was kept verbatim; its step list was a
     strict subset of the one below. Nothing else was dropped. -->

<!-- re-evaluated 2026-10-03 (second pass): the earlier "no second incident exists" verdict came from a
     correction-PHRASE scan and is FALSIFIED. A semantic read of the same archives (55 dirs; 187
     `user/message` turns with `source.kind == "user"`; 38 continuation banners dropped; all 149 kept
     turns read in full) found 8 genuine corrections of a decision the agent had recorded or
     implemented, one of which is a second independent incident of this skill's failure mode:
       `75da8f42` 2026-09-27 20:22:21 — the user pastes the context panel and asks 「没出发？」:
         「系统提示词 ~3.1K / 工具定义 ~38.7K」 (≈41.8K envelope); `53740d46` 20:28:35 pastes the
         `threshold unavailable … 229846-token flo…` receipt.
       26 minutes later commit `3837cc1` records the OPPOSITE direction — `floor = (totalTokens −
         surfaceTokens) + keep + MIN_SUMMARIZE_TOKENS` ⇒ 「自动交接永不触发」 — and calls the envelope
         composition 「那 ~202K baseline 的构成**仍未知**」: it discards the number the user supplied.
       `4cdeb0b9` 2026-10-02 21:34/21:38 — 「不应该出现undefined吧？」/「floor是下限？你floor是不是公式
         不对啊？修根因」; the agent agrees the basis was mixed.
       commit `e3aea8d` replaces the bullet: the real envelope is dsh's own `estimateToolsTokens` =
         42845 ≈ the user's 3.1K + 38.7K; the old conclusion was «a measurement-basis artifact read as
         model behaviour».
     The bar — "a second independent incident" — is therefore met on the merits; status stays
     `candidate: true` only because promotion writes a tracked skill and is the user's call.
     Caveat kept honestly: G's prior input is a *pointer* (a pasted measurement), not the words "I
     corrected you before"; no explicit prior correction for G exists in the archive.
     Re-run the read yourself instead of trusting these counts; `session-logs/` is gitignored and grows. -->

Use this when project memory or CONTEXT.md asserts a decision (a formula direction, a default, a config semantic, a preferred shape) and the user says they corrected it before, or when a handoff has flattened away the reasoning behind an existing setting. Do not defend the recorded version first.

1. Treat memory as a lossy projection of the sessions, not as ground truth. Memory has recorded a decision backwards before; the user's claim is a pointer into the logs, not a claim to evaluate.
2. Locate the candidate logs: `.agents/memory/session-logs/<session-id>/session.jsonl`, with ids from `INDEX.md`, the handoff chain, or a keyword grep over `.agents/memory/session-logs`. A grep is for **finding the logs**, never for deciding the correction is absent — see step 4.
3. Extract only genuine user turns: parse the JSONL and keep events whose type is `user/message` and whose `source.kind == "user"`. That kind test removes the injected context — `runtime-context`, `skill-catalog`, `skill-invocation`, `team-message`, `subagent-settled`, `compact-checkpoint` and `model-selection` each carry their own kind — but it does **not** remove a handoff banner: a continuation banner is itself `source.kind == "user"`. Drop those by their opener and size: they start with the localized `从会话 <id> 交接。` / `Handoff from session <id>.` (see `continuationPreamble` in `src/project-handoff/language.ts`) and run 70K+ characters against 2–300 for a real turn. Measured 2026-09-27 over the 48 v4 logs then on disk: the kind filter alone returned 8 banner hits and, by phrase count, "exactly 1" correction turn — that second number was a **phrasing artifact** (see step 4), so treat the filter as the *coarse* cut and the reading in step 4 as the decisive one. The banner also lacks the `clientTimeZone` that client-sent turns carry, but that is a hint, not a decisive test (a few client turns lack it too).
4. Read the kept turns chronologically and copy the user's own wording verbatim. Separate a correction from a restatement of an earlier proposal; only the correction is ground truth. **Do not gate this read on correction vocabulary.** A scan for 矫正/纠错/我说过/错了 over 149 kept turns (2026-10-03) returns one hit and misses the rest, because in this project corrections actually arrive as: a bare challenge that presupposes disagreement (「没出发？」「那也不对啊？」「不应该出现undefined吧？」「dsh应该有接口啊？」「跨度有这么大吗？」), a rhetorical "whose/again" (「你按谁的公式做的？我的还是你的？又添油加醋？」), a plain imperative (「删掉。」「修根因」「更新日志不要放到readme里」), or — worst — **evidence pasted with no correction word at all**. Two tells for a displaced reading, both usable without any correction phrasing: the user hands over the contradicting datum and memory later calls it *unknown/unrecoverable* (2026-09-27: the pasted panel gave 系统提示词 ~3.1K + 工具定义 ~38.7K; commit `3837cc1` still wrote 「那 ~202K baseline 的构成**仍未知**」), and the user re-asks the same question in a later session with an edge (「你floor是不是公式不对啊？」 2026-10-02). Read the tail of `session-logs/INDEX.md` and the loop's own commits in time order: the re-ask is the marker that the earlier answer was wrong.
5. Cross-check the log against `git log` / `git blame`: find the commit that implemented the disputed reading and any commit that reverted it. A revert commit plus a verbatim correction is conclusive; a revert with no correction means the reason is still unexplained — keep looking.
6. Before editing code, restate the corrected rule in one sentence and check it against the user's words. If two readings survive the logs, quote both and ask rather than pick one.
7. After fixing, update the memory or context entry that carried the wrong reading and record the source session id, so the next handoff cannot reintroduce it. The recovered decision itself belongs in project memory, never in a skill.
8. Validate the resulting change with the project's normal gate (typecheck, build, tests) and the usual mutant check if the change is a fix; the recovery only establishes what the code should do, not that it now does it.

## Traps

- Your own memory is not evidence of user intent. In this project MEMORY.md had the knee direction recorded backwards (chain vs cap), and trusting it over the sessions produced a commit that had to be reverted the next session.
- Do not open by defending the code or arguing the current behaviour is deliberate; if the user says they corrected you several times, the code is the suspect.
- A green test suite does not settle intent: six tests had fully pinned the old shallow trigger because they were written from the same wrong reading.
- Keep the recovered quotation in your answer so the user can confirm the reading before the behaviour change lands.
