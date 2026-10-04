# Batch B residual decisions — the `callAux` tools fallback and the autolearn retry-before-read

**Status: decided and implemented 2026-10-05** (the batch is the three commits ending at
`git log -1 --format=%h` when you read this; what landed and the one remaining deviation are in §6). Both residuals had been closed on 2026-10-05 as "deliberately not ported"
(`CHANGELOG.md` 未发布, `docs/upstream-pi-triage.md`). Re-reading pi's `callAux` and this repo's own
adapter path showed that both closure *reasons* rested on premises that did not hold, so the two
decisions were re-opened and re-made here.

Read-now commands for everything cited below are in §7.

## 1. Ground truth read

| Read | Revision / path |
| --- | --- |
| pi | `/mnt/Data/Projects/pi-project-context`, `git rev-parse HEAD` = `67073764f971b811e70d0bacc605f48d3c7c2bd9`, equal to `origin/master` |
| dsh source | `/nix/store/cl7chjvxjw81aizwlxar1k8n9z02yd3b-dsh-desktop-0.2.0-rc.2/lib/dsh-desktop/repo` (below: `$DSH`) |
| this repo | `src/shared/model-call.ts`, `src/project-autolearn/{parse,pass}.ts`, `src/project-memory/consolidate.ts` |

## 2. R2 — pi's sticky no-tools fallback

### 2.1 What pi actually does

- A provider failure that arrives as a finish reason makes `completeWithMeta` throw
  `AuxCallError(kind: "provider" | "incomplete")` — pi's own error class
  (`extensions/project-context/shared/llm.ts:120-173`).
- `toolsFallbackApplies` returns **false** for that class (`:217-221`): pi does **not** fall back when
  the provider answered with an error finish. It falls back only for a *thrown* failure.
- Otherwise it asks `classifyModelFailure` and falls back unless the class is `auth`, `quota` or
  `transient` (`:219-220`). That classifier matches **message text** with regexes
  (`shared/call-policy.ts:25-42`: `SHAPE_RE` / `AUTH_RE` / `QUOTA_RE` / `TRANSIENT_RE`, else `other`).
  So pi's guard is not "a tools-rejected class"; it is **fail-open over anything unclassified**.
- `callAux` (`shared/llm.ts:238-275`) makes it one-shot and sticky: only the first tools-carrying call
  of a pass may fall back, `toolsAttempted` is marked *before* the call, and `toolsDisabled` keeps
  `tools` off for the rest of the pass.

### 2.2 What dsh actually does

- No adapter throw escapes the stream: `$DSH/packages/llm/llm/src/index.ts:1152-1161`
  (`adapterFailureChunk`) normalizes it into a terminal `finish` chunk —
  `reason: { kind: "error" | "aborted", failure }`. So the code always travels *in-band*.
- Each adapter publishes the code from the provider status. Both routes this repo can run on map a
  rejected request body to the same code:
  - `$DSH/packages/llm/llm-deepseek/src/transport.ts:29-35` — 401/403 → `AUTH`, 402/quota →
    `QUOTA`, 429 → `RATE_LIMIT`, **400/413 or `invalid_request_error` → `INVALID_REQUEST`**, else
    `SERVER` / `HTTP_<status>`.
  - `$DSH/packages/llm/llm-pi-ai/src/stream.ts:42-68` (`classifyPiAiError`) — **`\b413\b` and
    `\b400\b|invalid.?request` → `INVALID_REQUEST`**, else `AUTH`/`QUOTA`/`RATE_LIMIT`/`SERVER`/
    `TIMEOUT`/`TRANSPORT`, falling back to `PI_AI_ERROR`. That adapter never throws mid-stream
    (`:131-133`): its failures are `error` events turned into error/aborted `finish` chunks.
- This plugin then reads that code and **discards it into a message**
  (`src/shared/model-call.ts:198-208`):
  `throw new Error("plugin model call failed (<code>): <message>")`. dsh's own contract for the base
  class says the code is the machine-routable class and to route on it — *"never by parsing
  `message`"* (`$DSH/packages/llm/llm/src/error.ts:16-23`).

### 2.3 The corrected premise

The recorded closure reason was: *"What is missing is an observed code: no reachable route here
rejects `tools`."* Two things are wrong with that as a reason to close:

1. **A tools rejection is an HTTP 400, and the code for a 400 is not something that has to be
   witnessed** — both adapters' own status/classifier maps name it, identically:
   `INVALID_REQUEST`. The premise was about observability, and the mapping is the observation.
2. **pi does not key on such a code at all.** There is no "tools rejected" class in pi to port; its
   trigger is a message-regex negative list applied fail-open.

What *is* real, and was recorded correctly, is the prerequisite: this plugin throws the code away.
That is the only missing seam for Option A below.

### 2.4 The decision — trigger policy

**Option A (recommended): request-shape codes only.** On the *first* tools-carrying call of a pass,
if the failure carries `code === "INVALID_REQUEST"` (plus, defensively, the generic `HTTP_400` /
`HTTP_413` fallbacks other adapters use), retry once without `tools` and keep them off for the pass.
What decides is the **code**, not the delivery path — and that is a real divergence from pi, whose
`toolsFallbackApplies` returns false for its own `AuxCallError` (a finish-carried provider failure).
pi can afford that because a provider rejection is *thrown* there; in dsh `adapterFailureChunk`
normalizes every adapter throw into the same in-band terminal `finish`, so the finish-carried failure
is exactly where a tools rejection arrives and must be the thing that falls back. Option B's
"marker" would therefore have to *include* that path, not exclude it.

**Option B (pi-faithful): fail-open.** Fall back for any failure whose code is not in
`{AUTH, INVALID_CREDENTIAL, QUOTA, ACCOUNT_QUOTA, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT}`, and add a
machine-readable marker to the synthesized finish failure so it stays excluded the way pi's
`AuxCallError` is.

A is the recommendation: dsh's adapters publish a code per rejection and this repo's rule is to route
on codes; A's predicate is small enough to test exhaustively; and B buys its extra coverage
(`PI_AI_ERROR`, `UNKNOWN`, unmapped codes) by importing pi's blanket default, which would spend one
model call on every unclassified failure of a pass.

### 2.5 Verification plan — no live route is required

A scripted `ctx.llm.stream` **is** a route: the tests already drive fake streams. Acceptance:

- **A1** first tools-carrying call fails with `INVALID_REQUEST`, the tools-free retry succeeds → the
  pass completes and the decision is stored.
- **A2** the same failure on a *later* tools-carrying call of the pass does not fall back.
- **A3** `AUTH` / `RATE_LIMIT` / `QUOTA` failures do not fall back.
- **A4** a finish-carried failure whose code is *not* a request-shape one (`AUTH`, `RATE_LIMIT`,
  `QUOTA`) does not fall back — the negative case. (An earlier draft of this criterion said "a
  finish-carried failure with no code"; that premise was void the moment the reader below started
  preserving the code, and it contradicted A1, which needs a finish-carried `INVALID_REQUEST` to fall
  back. The two are one mechanism, not two.)
- **A5** after a fallback, no later call in the pass carries `tools`.
- Mutants: drop the first-tools-call guard → A2 reddens; drop the sticky flag → A5 reddens; key on
  the message instead of the code → A3 reddens.

## 3. R1 — accept a parseable `max-tokens` text reply

### 3.1 The missing signal

`parseAutolearn` (`src/project-autolearn/parse.ts:56-64`) returns `{skill: null, needSessions: []}`
for **both** "the JSON object did not parse" and "it parsed and proposed nothing". `parseJsonObject`
already knows which happened — it returns `undefined` for the first — so the information exists and is
thrown away one call up. That is why `ask()` must discard *every* `max-tokens` reply and re-ask
(`src/project-autolearn/pass.ts:200-205`); reading first would report a cut reply as "no skill was
warranted".

### 3.2 Why accepting a parseable reply is safe — probe, not prose

`.agents/evidence/2026-10-05-autolearn-cut-parse-probe/probe.mjs` cuts one realistic reply (brace-heavy
body, a `}` inside a string value) at **every** position, in the three shapes a model emits, and asks
whether any cut that parses yields a partial or altered decision:

| shape | reply chars | cuts that parse | full, unmodified body | partial/different body |
| --- | --- | --- | --- | --- |
| bare JSON | 301 | 0 | 0 | **0** |
| fenced JSON | 313 | 4 | 4 | **0** |
| JSON + trailing prose | 434 | 133 | 133 | **0** |

The bare-JSON row is the important one: a cut pure-JSON reply never parses, so the retry still fires
exactly where it must. The other rows are R1's population — the object had already closed and the cut
landed in the fence or the prose — and every one of them carries the *complete* body. The reason is
structural: `parseJsonObject` runs a raw `JSON.parse` over the emitted bytes, so a parse success means
every parsed string, object and array was closed in the emitted text. A half-emitted body cannot
parse. The dangerous half — a *repaired* argument string — is the **tool-call** path, and that stays
covered by `toolCallIsTruncated`.

### 3.3 The decision

Implement the explicit parse-success signal, then accept a `max-tokens` reply that (a) carries **no**
tool call and (b) whose text parses. Keep the tool-call half exactly as it is.

Acceptance criteria:

- **R1-a** a cut bare-JSON reply that does not parse is still retried (the population stays 0-parses).
- **R1-b** a `max-tokens` reply whose object closed before the cut is accepted with **one** model call.
- **R1-c** a `max-tokens` reply carrying a tool call is still retried (`toolCallIsTruncated`).
- **R1-d** the pinned case in `test/autolearn.test.mjs` is extended to R1-a + R1-b, not deleted.

### 3.4 What this supersedes

The recorded rationale ("the text parser is fail-soft, so retry before reading") is **right about the
tool half and wrong about the text half once the signal exists**. The asymmetry was a workaround for a
missing signal, not a property of the contract. The inversion is deliberate and gets its own comment
in `src/project-autolearn/pass.ts` plus the updated entries in `docs/upstream-pi-triage.md` and
`CHANGELOG.md`.

## 4. Deliberately unchanged

A call that the adapter repaired but whose finish reason is `stop` remains undetectable: nothing in
the reply distinguishes "the model emitted this complete" from "the adapter closed a cut string", and
neither adapter reports a repair. R1's signal does not help there and is not claimed to.

## 5. Relationship to the earlier record

This file supersedes the two closing sentences in `CHANGELOG.md` 未发布 ("未移植项现均以「已决定不移植」
收口") and the corresponding entries in `docs/upstream-pi-triage.md`. `needsCondense` is unaffected: it
is implemented as tier C and the decision in `docs/batch-c-tier-c-design.md` stands.

## 6. Implementation — what landed, and where it deviates

Landed across the batch's own code and test commits (`git log --oneline` since the decision commit;
no client code, so the client bundle is unchanged). Two of them correct earlier ones: a self-review
found the state-free helper below rested on a false premise, and the fail-soft parser wrapper lost its
last caller once `ask()` read through the reporting function.

- **R2**: `failure.code` now rides on the error `requestPluginTextWithMeta` throws (own property, the
  message byte-identical to what the plugin always threw), and `callWithToolsFallback` retries a
  tools-carrying call once without `tools` when — and only when — the code is in
  `{INVALID_REQUEST, HTTP_400, HTTP_413}`. Both passes call through it, each handing it the pass's own
  `ToolsFallbackState`. Verifying it needed no live route: the tests script a stream that answers a
  `tools`-carrying request with an in-band error finish, which is exactly how a real 400 arrives.
  - **pi's sticky switch is implemented, not dropped.** The first version of this code argued that each
    pass issues exactly one tools-carrying call, so `toolsAttempted` / `toolsDisabled` would be
    unreachable. That premise is false and the review that caught it is why the code changed: autolearn
    asks a second time when the first decision wants archives read before it commits
    (`ask(backtrackPrompt(...))`), so a route that had just refused `tools` would have been offered them
    again. The switch is therefore pi's — only the first tools-carrying call may fall back, marked
    before the call so a call that *succeeded* with tools also counts as "this route accepts them", and
    no later call of the pass carries tools once one has been refused — and the backtrack case pins it.
  - **The one remaining deviation (the trigger set is a positive list, not pi's negative one).** pi
    falls back on anything its message-regex classifier does not call auth/quota/transient. dsh's
    adapters publish a code per rejection, so the trigger is the code that means "the request's shape
    was refused"; a failure that is not in that set is never re-asked without tools.
- **R1**: `parseAutolearnReply` returns `undefined` for a reply with no readable object and
  `{skill: null}` for one that parsed and proposed nothing; the fail-soft `parseAutolearn` is now
  defined on top of it and keeps its old contract (pinned by `test/logic.test.mjs`). `ask()` accepts a
  `max-tokens` reply whose text parsed and still re-asks for one that did not; the tool-call half is
  untouched.
- **Accepted residuals from the adversarial review of this batch** (2026-10-05; the review's own
  reproduction is in its report, the shapes are re-runnable in
  `.agents/evidence/2026-10-05-draft-object-tail-probe/`):
  - *The draft-object tail is accepted by both passes.* A reply that completes one object, adds prose,
    then starts a **second** object and is cut before closing it parses to the earlier object, because
    `parseJsonObject` slices from the first `{` to the last `}`. The probe shows the memory pass
    storing `- draft entry` from that shape and the autolearn pass taking `draft-skill`; the fenced /
    trailing-prose shapes are unaffected. This is a property of the shared decoder that the memory
    pass has always had (it reads before it retries), which R1 aligned autolearn with — not a
    regression R1 introduced. Fixing it means a span-aware "the parsed object must be the last one
    started" rule applied to **both** passes, which is a new design decision; until then the accepted
    cost is that a model which drafts, reconsiders and is cut gets its draft used instead of being
    asked again. The R1 probe's result line was narrowed to say which shapes it covers.
  - *`INVALID_REQUEST` is wider than "the route refused `tools`".* dsh also emits it for local
    serialize/validation failures and for any provider 400. The accepted cost is one wasted tools-free
    call in those cases; the bound is structural — the retry is a single non-recursive `call(false)`,
    the pass switch stops any later call from offering tools, and the pass's throttle is a plain
    `throttle.set` that the single catch around the pair executes once, so no failure slot is burned
    twice.
- **Mutation-checked** (five valid mutants, each 0 `tsc` errors, marker present in `lib/`, and exactly
  the named cases turning red): removing the parse signal reddens only the parseable-cut case;
  emptying the request-shape set reddens the three fallback-dependent cases; replacing the membership
  test with "any code-bearing failure" reddens only the auth negative, which is what pins the
  discrimination; removing the pass switch reddens only the backtrack case, which is what shows the
  state is reachable rather than ceremony; and dropping the code from the thrown error reddens the new
  seam assertion plus those same three fallback cases.
- Gate when the batch was pushed: `pnpm typecheck` 0 errors, `node --test` 328 pass / 0 fail (323
  before, +5), `lib/` identical to a fresh `tsc` compile except `client.js` (28376 bytes, unchanged —
  no client code moved).

## 7. Read-now checks

```sh
# pi revision
git -C /mnt/Data/Projects/pi-project-context rev-parse HEAD origin/master
# pi's fail-open guard and its message-regex classifier
grep -n "toolsFallbackApplies" -A 6 /mnt/Data/Projects/pi-project-context/extensions/project-context/shared/llm.ts
grep -n "const SHAPE_RE\|const AUTH_RE\|const QUOTA_RE\|const TRANSIENT_RE" /mnt/Data/Projects/pi-project-context/extensions/project-context/shared/call-policy.ts
# a provider 400's code, on both routes
DSH=/nix/store/cl7chjvxjw81aizwlxar1k8n9z02yd3b-dsh-desktop-0.2.0-rc.2/lib/dsh-desktop/repo
sed -n '25,40p' $DSH/packages/llm/llm-deepseek/src/transport.ts
sed -n '42,68p' $DSH/packages/llm/llm-pi-ai/src/stream.ts
sed -n '1152,1161p' $DSH/packages/llm/llm/src/index.ts
# the code this plugin throws away
grep -n "failure.code\|plugin model call failed" /mnt/Data/Projects/dsh-project-context/src/shared/model-call.ts
# the R1 probe
node /mnt/Data/Projects/dsh-project-context/.agents/evidence/2026-10-05-autolearn-cut-parse-probe/probe.mjs
```
