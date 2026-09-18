# Draft upstream report — a browser tab can go silently send-dead after a host restart

Status: **draft — technically complete; only the live capture in "Evidence to attach" is missing.**
Target: `deepseek-ai/deepseek-harness` (Issue, or Discussion if triage prefers).
Every claim under "Verified in the shipped code" was read in **`dsh-0.1.6-alpha.2`** and is given with
an exact `file:line`, plus the command to re-check it. Everything under "Not established" is a
hypothesis, not a finding.

## Summary

After the host restarts, a browser tab that was already open can keep rendering a normal, live UI —
composer editable, **Send enabled** — while nothing it sends ever reaches the host. No error is shown
and the composer never clears. Opening a **fresh** tab in the same browser against the same host works
immediately, and the old tab stays dead; reloading the page also clears it.

This is client-side and does not implicate the host, the session store, or any plugin: a brand-new tab
in the same browser process talks to the same server without trouble.

## Environment

- dsh `0.1.6-alpha.2`. Seen against a restarted `dsh` host — both a `dsh web` server
  (`127.0.0.1:3080`) and the packaged desktop app (electron host on `127.0.0.1:19387`).
- Client: Firefox on Wayland (Linux/NixOS). No browser automation was available on the reporting
  machine, so the console/network capture below has to be done by hand.

## Reproduction (as observed)

1. Have a dsh page open with a session loaded.
2. Restart the host (restart the server, or restart the desktop app that owns it).
3. Wait for the restarted host to be serving again.
4. In the **old** tab: type a message and press Send.
   - Observed: nothing is sent; the draft stays in the composer; no error appears anywhere in the UI.
   - The tab may also show a turn as still "running" when it is not.
5. Open a **new** tab to the same URL: sending works at once, in the same browser process.

Frequency: **intermittent.** Not every restart reproduces it — a desktop restart on 2026-09-18 with an
open tab did *not* reproduce it. So "restart the host" is a trigger candidate, not a sufficient cause.

## Verified in the shipped code (dsh-0.1.6-alpha.2)

Read from the shipped client bundles/sources, not inferred from the symptom.

- **Retry is driven only by carrier loss; there is no liveness probe.**
  `ConnectionRecoveryController.loop` (`packages/client/connection/src/client/connection.ts:164-270`)
  emits `disconnected` (`:170`) or `connecting` (`:185`), sleeps `backoffDelay(attempt)` (`:191`), then
  reopens a generation and emits `connected` in the readiness handshake (`:254`). The delay is
  `cap/2 + random*cap/2` where `cap = min(backoffMaxMs, backoffBaseMs * backoffFactor**(attempt-1))`
  (`:139-146`), and `backoffMaxMs` defaults to **10 000 ms**
  (`packages/client/connection/src/recovery-config.ts:28`). A grep for
  `heartbeat|"ping"|pong|keepalive` across `packages/client/connection/src/` returns **nothing**: a
  carrier that is open but no longer carrying traffic is indistinguishable from a healthy one.
- **A generation change is announced, but the conversation UI does not listen.**
  `onReconnectRequested` is fired on every reconnect (`connection.ts:197`), and the sinks are
  `onConnected` / `onReconnectRequested` / `onStateChange` (`emitState`, `:271`) — but
  `packages/client/ui-conversation/src/` registers **no** consumer for any of them (grep returns
  nothing). A reconnect therefore rebinds the transport with no obligation on the input layer to
  re-validate its own state.
- **The composer has *two* places that can hold a draft forever, and neither surfaces an error.**
  `InputFacade.sinkSerialized` (`packages/client/ui-conversation/src/client/input/facade.ts:611-658`):
  - **Reference-bearing drafts only** (`@` chips, `occurrences.length !== 0`): the send is routed
    through `await inputTriggers.serializeReference(...)` (`:635`) *before* `defaultSink` is ever
    called. A promise that never settles (rather than rejects) means neither the fulfil nor the reject
    handler for `Promise.all` ever runs (`:637-656`), so the draft is never restored and no failure is
    surfaced.
  - **Any draft**: the chip-free path calls `defaultSink` immediately (`:625-627`), and `settleSink`
    (`:661-680`) attaches its handlers. If that promise never settles either, the same silence follows —
    so the stall is not exclusive to `@` chips; the serializer is merely a second, earlier place to
    stall.
- **Failure *is* normally reported, which is what makes silence diagnostic.**
  `settleDetachedFailure` (`facade.ts:683-693`) restores the draft and dispatches
  `sink-settled` with `ok: false` (`:692`). So if the UI shows nothing, the send did not *fail* — it
  never completed.
- Endpoint for the capture below: `/api/remote.mux`
  (`packages/api/gateway/src/stream-protocol.ts:6`).

## Not established (honest gaps)

- Which of the above is the actual trigger. The tab went quiet **after a host restart**, which points at
  the connection-generation path, but no console or network evidence was captured at failure time.
- Which of the two stall sites is hit. This is decidable from the capture: **if no request frame ever
  leaves the socket**, the stall is before/inside `serializeReference`; **if a frame leaves and never
  gets a reply**, it is transport-side.
- Whether the old tab's socket is closed, open-but-idle, or already rebound to a new generation.
- Whether a stale session-store subscription (rendering from a generation that no longer writes) is
  involved. Nothing in the code disproves it.
- Whether the "running" indicator is the same defect or a separate one.

## Evidence to attach (this is the only thing still missing)

Captured **in the old tab, at the moment sending stops working**. Open DevTools *before* reproducing.

1. **Console**, filtered to `[connection]`. The retry loop logs
   `[connection] connection lost, retry #N` once per attempt (`connection.ts:196`). Its presence
   separates "carrier seen as lost" from "carrier believed healthy".
2. **Network → WS → the `/api/remote.mux` socket**: is it closed, open with no traffic, or carrying
   frames that get no reply? Note whether **any** frame is sent when Send is pressed — that is what
   splits the two stall sites above.
3. **Whether recovery ever completes**: does `ConnectionRecoveryController` reach `emitState('connected')`
   again, and does the composer's `phase` leave `plain`? (Both observable in the console by evaluating
   the input hub snapshot, or by watching the draft state.)
4. Browser + dsh version, and whether the draft contained any `@` reference chips.

## Verification commands (for a maintainer, against a checkout)

```sh
REPO=<path-to-dsh-repo>
grep -rniE 'heartbeat|"ping"|pong|keepalive' "$REPO/packages/client/connection/src/"   # expect: nothing
grep -rn  'backoffMaxMs' "$REPO/packages/client/connection/src/recovery-config.ts"        # expect: default 10_000
grep -rn  'onStateChange\|onConnected\|onReconnectRequested' "$REPO/packages/client/ui-conversation/src/"  # expect: nothing
grep -rn  'connection lost, retry' "$REPO/packages/client/connection/src/"               # expect: connection.ts:196
sed -n '611,700p' "$REPO/packages/client/ui-conversation/src/client/input/facade.ts"      # the two stall sites
```

## Workaround

Close the stale tab and open a new one, or hard-reload it (a plain reload suffices in practice).

## Related upstream reports

Both were found while checking for duplicates, and describe the same family of symptom:

- Discussion #511 — "[Bug] 后台服务停止响应后，页面永久显示"运行中"，且无法停止、发送消息或提交反馈"
  (<https://github.com/deepseek-ai/deepseek-harness/discussions/511>)
- Discussion #2842 — "[Bug] Question/approval cards missing on mobile until page refresh — WebSocket
  silently suspended, no heartbeat / no visibilitychange reconnect"
  (<https://github.com/deepseek-ai/deepseek-harness/discussions/2842>)

**Caveat, to keep in the filed report:** neither was read in full. `github.com` resolves to a
non-public IP address on the reporting machine (only `ssh.github.com:443` is reachable), so the
discussion bodies could not be fetched — they are cited for triage, not as confirmation. **Whoever
files this should read them first** and link them properly, or close this as a duplicate.

Prior art in the ecosystem (community plugins, unverified):

- `tqcq/dsh-auto-reconnect` — "Client-only auto-reconnect for the DSH web client."
- `StvLi/dsh-phoenix` — graceful restart + client auto-reconnect + cross-restart goal continuation.

Their existence suggests the gap is real and commonly hit, and that a client-side liveness/reconnect
fix is feasible without host changes.

## Submit checklist

- [ ] Capture the section above, paste it in, delete the "draft" status line.
- [ ] Read #511 and #2842 from a machine with GitHub access; link or de-duplicate.
- [ ] File as an Issue (not a Discussion) so it can be triaged as a bug; reference this repo
      (`P02-1010751281/dsh-project-context`) only if reproduction context is useful.
