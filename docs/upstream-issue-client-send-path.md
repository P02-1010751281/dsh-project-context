# Draft upstream report — a browser tab can go silently send-dead after a host restart

Status: **draft, not filed.** Written to be posted to `deepseek-ai/deepseek-harness` (Discussion or
Issue) once the missing evidence below is captured. Everything in "Verified in the code" was read in
`dsh-0.1.6-alpha.2`; everything in "Not established" is explicitly a hypothesis, not a finding.

## Summary

After the host restarts, a browser tab that was already open can keep rendering a normal, live UI —
composer editable, **Send enabled** — while nothing it sends ever reaches the host. No error is shown
and the composer never clears. Opening a **fresh** tab in the same browser against the same host works
immediately, and the old tab stays dead. Reloading the page also clears it.

This is client-side and does not implicate the host, the session store, or any plugin: a brand-new tab
in the same process talks to the same server without trouble.

## Reproduction (as observed)

1. Have a `dsh web` page open with a session loaded.
2. Restart the host (`Ctrl-C` then start it again, or restart the desktop app that owns it).
3. Wait for the restarted host to be serving again.
4. In the **old** tab: type a message and press Send.
   - Observed: nothing is sent; the draft stays in the composer; no error appears anywhere in the UI.
   - The tab may also show a turn as still "running" when it is not.
5. Open a **new** tab to the same URL: sending works at once, in the same browser process.

## Verified in the code

These are read from the shipped client bundles/sources, not inferred from the symptom.

- **Retry is driven only by carrier loss.** `ConnectionRecoveryController`
  (`packages/client/connection/src/client/connection.ts`) loops: on a lost generation it emits
  `disconnected`, sleeps an exponential backoff (`backoffDelay`, cap `backoffMaxMs` = 10 000 ms in
  `recovery-config.ts`), then opens a new generation. There is **no heartbeat, ping/pong, or periodic
  liveness probe** in `packages/client/connection/src/` — a carrier that is open but no longer carrying
  traffic is indistinguishable from a healthy one.
- **A generation change is announced, but the conversation UI does not listen.**
  `onConnected` / `onReconnectRequested` / `onStateChange` are the sinks the controller offers, and
  `packages/client/ui-conversation/src/client/` registers **no** consumer for them. So a reconnect
  rebinds the transport without any obligation on the input/conversation layer to re-validate its own
  state.
- **The composer's send path can hold a draft without an error.** `InputFacade.sinkSerialized`
  (`packages/client/ui-conversation/src/client/input/facade.ts`) routes a draft with `@` reference
  chips through `await inputTriggers.serializeReference(...)` before calling the sink. Reference-free
  drafts skip that await entirely. A promise that never settles (rather than rejects) leaves the attempt
  pending: `settleSink`'s rejection handler never runs, so the draft is never restored and no failure is
  surfaced — from the outside, Send looks enabled and does nothing.
- **Failure *is* normally reported.** `settleDetachedFailure` restores the draft and dispatches
  `sink-settled` with `ok: false`, so a genuine `defaultSink` rejection should be visible. The silent
  case therefore means the send did not fail — it never completed.

## Not established (honest gaps)

- Which of the above is actually the trigger. The observed tab went quiet **after a host restart**, which
  points at the connection-generation path, but no console or network evidence was captured at failure
  time.
- Whether the old tab's socket is closed, open-but-idle, or already rebound to a new generation.
- Whether a stale session-store subscription (rendering from a generation that no longer writes) is
  involved. Nothing in the code disproves it.
- Whether the "running" indicator is the same defect or a separate one.

## Evidence that would settle it

Captured in the **old** tab, at the moment sending stops working:

1. Browser console, filtered to `[connection]` — the retry loop logs
   `[connection] connection lost, retry #N` on every attempt, so its presence/absence divides
   "carrier seen as lost" from "carrier believed healthy".
2. The same tab's WebSocket activity (`api/remote.mux` frames or the Network panel): is the socket
   closed, open with no traffic, or carrying frames that get no reply?
3. Whether `ConnectionRecoveryController` ever reaches `emitState('connected')` again, and whether the
   composer's `phase` ever leaves `plain`.

## Workaround

Close the stale tab and open a new one, or hard-reload it (a plain reload suffices in practice).

## Related upstream reports

Found while checking for duplicates; both describe the same family of symptom and were **not** read in
full (GitHub is unreachable from the machine this draft was written on), so they are cited for triage
rather than as confirmation:

- Discussion #511 — "[Bug] 后台服务停止响应后，页面永久显示“运行中”，且无法停止、发送消息或提交反馈"
  (<https://github.com/deepseek-ai/deepseek-harness/discussions/511>)
- Discussion #2842 — "[Bug] Question/approval cards missing on mobile until page refresh — WebSocket
  silently suspended, no heartbeat / no visibilitychange reconnect"
  (<https://github.com/deepseek-ai/deepseek-harness/discussions/2842>)

Prior art in the ecosystem (community plugins, unverified):

- `tqcq/dsh-auto-reconnect` — "Client-only auto-reconnect for the DSH web client."
- `StvLi/dsh-phoenix` — graceful restart + client auto-reconnect + cross-restart goal continuation.

Their existence suggests the gap is real and commonly hit, and that a client-side liveness/reconnect
fix is feasible without host changes.
