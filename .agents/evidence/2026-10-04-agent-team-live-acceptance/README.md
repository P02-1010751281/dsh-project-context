# Agent-team tools: live acceptance on `ctxdev` and `headless` (2026-10-04)

**What was missing.** The `ctxdev` and `headless` profiles had only **parse-level** evidence that
they still carry the agent-team capability: both `dsh --profile <p> --dump-config` outputs resolve
the `@deepseek-ai/dsh-experimental-agent-team*` entries with no skip or incompatibility. That proves
the plugin stack *composes*; it does not prove the tools *invoke*. This run closes that gap by
calling them and reading the returned data.

**Revision read.** `dsh --version` = `0.2.0-rc.2`; profiles as resolved by
`~/.dsh/profiles/<p>/package.json`:

| profile | bundles |
|---|---|
| `ctxdev` | `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-headless`, `dsh-project-context`, `@deepseek-ai/dsh-experimental-agent-team-profile` |
| `headless` | `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-headless`, `@deepseek-ai/dsh-experimental-agent-team-profile` |

**Method.** `dsh --profile <p> --json "<task>"` is a one-shot headless run, so the `--json` event
stream records each `tool_call` and its `tool_result` as structured events. That makes the test
falsifiable: a tool that is *listed* but not *callable* shows up as a failed or absent `tool_call`,
not as prose. Each run used a fresh throwaway project directory under `/tmp`, so no real project
state was touched.

```bash
dsh --profile ctxdev   --json "<task>" > out.jsonl
dsh --profile headless --json "<task>" > out.jsonl
```

**Results.**

| profile | tool | `tool_result.status` | returned |
|---|---|---|---|
| `ctxdev` | `team_task_create` | `completed` | `{"id":"task-1","revision":1,"subject":"probe-acceptance","status":"pending","blockedBy":[],"writeScopes":[],"ready":true}` |
| `ctxdev` | `team_task_list` | `completed` | `{"tasks":[{…"id":"task-1"…}]}` |
| `ctxdev` | `list_agents` | `completed` | `[{"target":"lead","role":"lead","status":"running","model":"deepseek-flash","diagnostics":[]}]` |
| `headless` | `team_task_create` | `completed` | `{"id":"task-1","revision":1,"subject":"probe-headless",…"ready":true}` |
| `headless` | `team_task_list` | `completed` | `{"tasks":[{…"id":"task-1"…}]}` |

Both runs exited `0` with empty stderr. Sessions: `session-a1dd144d-1e38-4979-8ded-59f6a8ee0403`
(`ctxdev`), `session-593c6c33-9c0e-4dd6-ac2b-57816853309e` (`headless`). The raw event streams are
next to this file as `ctxdev-out.jsonl` and `headless-out.jsonl`.

**Honest limits.**

- This exercises the **one-shot headless app**, which is what these two profiles boot. It does not
  exercise the desktop/web GUI path.
- `spawn_teammate` was deliberately **not** called: creating a real teammate is not a read-only
  probe, and the project rule is not to spawn teammates unless the user asks. So "the tool is
  registered and callable" is evidenced for the task-board and roster tools; `spawn_teammate` is
  covered only as far as `list_agents` returning the live lead row proves the catalog is wired.
- A task created by these probes lives on the throwaway project's own task board under `/tmp`; it is
  not a task in any real workspace.
- The evidence is a point-in-time reading of `0.2.0-rc.2`. A profile or dsh-line change can
  invalidate it; re-run the two commands above rather than citing this file.
