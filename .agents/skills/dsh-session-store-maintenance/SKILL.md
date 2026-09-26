---
name: dsh-session-store-maintenance
description: "Inspect, probe, repair, and tidy the local dsh session store (~/.dsh) safely while working on the dsh-project-context plugins."
---

Use when a task requires looking at, probing, repairing, or cleaning up dsh sessions on this machine while working on the project-context plugins.

## Ground rules
- Read-only inspection of `~/.dsh` is acceptable. Never send messages into the user's real sessions unless they explicitly approve a rescue.
- Do not restart the user's `dsh web` service; propose it instead. Plugin code changes load only at the next start.
- Create throwaway probe sessions only under `/tmp`, and archive them afterwards.
- A second agent session may be working in this repo concurrently: stage only the paths changed for the current task (`git add <paths>`), never `add -A`.

## Probe the running server (read-only)
- Wrapper: `/tmp/rpc.sh <method> '<json args>' 3080` against `dsh web` on `127.0.0.1:3080`.
- Argument shapes differ per method: `session/list` wants `{"args":{"_request":{}}}`; `session/page` wants `{"args":{"request":{...}}}`; workspace mutations want `{"args":{"request":{...}}}`.
- Confirm a session is loadable with `session/page`; expect HTTP 200.
- Caution: probing `session/create` makes the server load the sessions it touches and grows RSS; a restart releases it.

## Read a session log
- Path: `~/.dsh/sessions/<encoded-cwd>/<session-id>/session.v3.jsonl.zstd` (current) or legacy `session.jsonl.zstd` (v0).
- Decompress with `zstdcat <file>` and parse the JSONL events.
- v0 logs are migrated in memory and usually open fine; only v0 logs carrying an old subagent descriptor are refused (history unreadable, raw file left on disk). Disk format alone is not the discriminator.
- Layout: the writer emits one zstd frame per append batch, header frame first, checksum flag on; the reader decodes frame by frame.

## Workspace grouping
- Sidebar grouping comes from workspace membership in `~/.dsh/storages/workspace.json` (`tables.workspaces` is a dict keyed by workspace id, each value `{path,title,sessionIds:[...]}`), not from session cwd; archived ids live in the registry-global archive set `global.archivedSessionIds`.
- A session joins a workspace at creation: `session/create` with `workspaceId` (mutually exclusive with `cwd`) takes the cwd from the workspace record and attaches the session. `workspace/insertSessionBefore` cannot move an unaccounted session in.
- Attach an existing session by idempotent adopt: `session/create {"sessionId":"<id>","workspaceId":"<ws>"}`.
- Adopt is refused for subagent children (error `session/agent-busy`; read those via `session/page`/`session/follow` with the `{kind:"subagent",parentSessionId,childSessionId,mode}` address) and for legacy sessions whose v0 log carries an old subagent descriptor.
- Hide a session (no delete-session RPC exists): `workspace/archiveSession {"args":{"request":{"sessionId":"..."}}}` adds it to the archive set the sidebar filters out.

## Repair a log the harness refuses to load
Symptom: a session becomes unloadable (`gateway/internal`) because its log contains an event type outside the harness's known set and not marked `ignorable: true`. Plugins must not append custom session event types at all; write project-side files instead.
1. Confirm the server currently holds no writer on that file (the failing load is what makes patching safe).
2. Back the file up (e.g. `/tmp/session-repair-backup/`).
3. Locate the offending frame: split the file on zstd frame boundaries and find the small standalone frame that holds the bad event, typically the last append batch.
4. Recompress only that frame with `"ignorable": true` added to the event envelope, keeping all preceding bytes byte-identical and the frame's checksum flag unchanged.
5. Verify with `session/page` → HTTP 200.

## Session-log constraint (regression guard)
- A downstream plugin cannot set `ignorable` when appending: `Session.append(type, data, opts)` only accepts `sourceEventSeqs`/`surfaceOp`, and the schema allows only the literal `true`.
- After any change touching session events, scan `src/**/*.ts` to confirm nothing appends a session event or declares a custom event type, then run `pnpm typecheck` and `pnpm test`.
