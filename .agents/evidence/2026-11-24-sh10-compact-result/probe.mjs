#!/usr/bin/env node
/**
 * SH-10 closing probe: drive `ctx.compaction.compactNow` on a THROWAWAY probe
 * agent (cwd under `mkdtemp('/tmp/…')`) in the live dsh desktop host and record
 * whether it returns a non-null compressed result.
 *
 * Safety contract (enforced by construction, not by convention):
 *  - touches ONLY the agent it creates; every user session is left alone
 *    (never prompted, never compacted, never archived);
 *  - the probe agent is `dispose()`d before the script returns, and the host's
 *    live agent list is read back to prove nothing was left behind;
 *  - no repo file, profile, or host process is modified.
 *
 * Modes
 *   node probe.mjs                 # full run, INCLUDING one summarization model call
 *   SKIP_COMPACT=1 node probe.mjs  # everything except the model call (free)
 *   RACE=1 node probe.mjs          # race probe only: archive-during-maintenance (free)
 *
 * RACE mode is the "does an idle-window handoff retirement collide with a
 * maintenance job" question. It uses `agent.runMaintenance` with a synthetic
 * sleep instead of a real summarization call, so it costs nothing; the real
 * compaction run above already samples status/activity through its own
 * maintenance window.
 *
 * Environment
 *   INSPECTOR        inspector base url           (default http://127.0.0.1:9230)
 *   ROUNDS           synthetic turns to append    (default 6)
 *   FILLER           filler repetitions per msg   (default 14 → ~2.2 KB / message)
 *   PROBE_PROVIDER   route for the probe agent    (default magpie)
 *   PROBE_MODEL      model for the probe agent    (default auto/deepseek-v4.1-flash)
 *   SAMPLE_MS        status/activity sample rate  (default 400)
 *   SKIP_COMPACT     "1" to skip the compaction call
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cfg = {
  inspector: process.env.INSPECTOR ?? 'http://127.0.0.1:9230',
  rounds: Number(process.env.ROUNDS ?? 6),
  filler: Number(process.env.FILLER ?? 14),
  model: process.env.PROBE_MODEL ?? 'auto/deepseek-v4.1-flash',
  provider: process.env.PROBE_PROVIDER ?? 'magpie',
  sampleMs: Number(process.env.SAMPLE_MS ?? 400),
  skipCompact: process.env.SKIP_COMPACT === '1',
  race: process.env.RACE === '1',
}
const cwd = mkdtempSync(join(tmpdir(), 'sh10-probe-'))

const list = await (await fetch(`${cfg.inspector}/json/list`)).json()
if (!Array.isArray(list) || list.length === 0) throw new Error(`no inspector target at ${cfg.inspector}/json/list`)
const target = list[0]
const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = nextId++
  pending.set(id, { res, rej })
  socket.send(JSON.stringify({ id, method, params }))
})
socket.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) rej(new Error(m.error.message))
    else res(m.result)
  }
})
await new Promise((r, j) => {
  socket.addEventListener('open', r, { once: true })
  socket.addEventListener('error', j, { once: true })
})
await send('Runtime.enable')

const expr = String.raw`(async () => {
  const cfg = ${JSON.stringify(cfg)}
  const cwd = ${JSON.stringify(cwd)}
  const out = {
    target: { title: ${JSON.stringify(target.title ?? null)}, url: ${JSON.stringify(target.url ?? null)} },
    config: { ...cfg, cwd },
    steps: [],
  }

  // ---- reach the cordis root: Inspector retains realm objects keyed by symbol ----
  const table = globalThis[Symbol.for("dsh.inspector.realm-object-registries")]
  let root
  for (const registry of table.values()) for (const obj of registry.retained.values()) {
    try { if (obj?.root && obj?.registry && obj?.events) { root = obj.root; break } } catch {}
    if (root) break
  }
  if (!root) { out.steps.push({ step: "root", error: "no cordis root in the Inspector retained realm objects" }); return out }
  out.steps.push({ step: "root", ok: true, hostPlaneCompaction: String(root.get("compaction")) })

  const agents = root.get("agents")
  const presets = root.get("agentPresets")
  const meter = root.get("tokenMeter")
  const projections = root.get("sessionProjections")
  const hostAgentsBefore = agents.list().map(a => String(a.id))
  out.hostAgentsBefore = hostAgentsBefore

  const probeId = "session-probe-sh10-" + Date.now().toString(36)
  out.probeId = probeId
  let handle
  let agent
  try {
    handle = await agents.create({
      sessionId: probeId,
      meta: { cwd, agentPreset: "standard" },
      agentOptions: { provider: cfg.provider, model: cfg.model },
    })
    agent = handle.agent ?? handle
  } catch (error) {
    out.steps.push({ step: "create", error: String(error?.message).slice(0, 300) })
    return out
  }

  const statusLog = []
  const startedAt0 = Date.now()
  let stopStatusLog
  try {
    stopStatusLog = root.on("agent/status", ({ agent: a, status }) => {
      if (String(a.id) !== String(probeId)) return
      statusLog.push({ atMs: Date.now() - startedAt0, status })
    })
  } catch (error) { out.statusLogHook = "ERR " + String(error?.message).slice(0, 160) }

  const snap = () => {
    let engine
    try { engine = presets.serviceFor(agent, "compaction") } catch { engine = undefined }
    return {
      status: agent.status,
      events: agent.session.snapshotEvents().length,
      surface: agent.session.surface.nodes.length,
      engine: engine === undefined ? "undefined" : typeof engine,
      compactNow: typeof engine?.compactNow,
    }
  }
  const measureOf = (session) => {
    try {
      const m = meter.measure(session)
      return {
        totalTokens: m.totalTokens,
        surfaceTokens: m.surfaceTokens,
        nodeCount: m.nodes.length,
        baselineKind: m.baseline.kind,
        baselineTokens: m.baseline.tokens,
        logRevision: m.logRevision,
      }
    } catch (error) { return { error: String(error?.message).slice(0, 200) } }
  }
  const projectionOf = (session) => {
    try { return projections.snapshot(session, ["contextBreakdown", "contextPressure"]) } catch (error) { return { error: String(error?.message).slice(0, 200) } }
  }
  const activityNow = async (sessionId) => {
    try {
      return await root.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]))
    } catch (error) { return "ERR " + String(error?.message).slice(0, 160) }
  }

  try {
    // ---- the two known traps, re-confirmed in one line each ----
    out.steps.push({ step: "unmounted", ...snap() })
    await presets.mount(agent.ctx, "standard")
    await agent.whenIdle()
    out.steps.push({ step: "mounted", ...snap() })

    // ---- synthesize history: ZERO model calls, only session appends ----
    const s = agent.session
    const uid = (i, hi) => "01930000-0000-4000-" + hi + "-" + String(i).padStart(12, "0")
    const filler = "The probe transcript line names packages/core/session/src/surface.ts, records the command node --test, and states the observed value 17. "
    let uidCounter = 1
    s.append("request/header", {
      header: { config: { provider: cfg.provider, model: cfg.model, maxTokens: 4096 } },
      reason: "initial",
    })
    for (let round = 1; round <= cfg.rounds; round += 1) {
      s.append("turn/start", { turn: round })
      s.append("step/start", { turn: round, step: 1 })
      if (round === 1) {
        s.append("system/message", {
          turn: 1,
          step: 1,
          message: {
            id: uid(uidCounter++, "8000"),
            role: "system",
            content: [{ type: "text", text: "You are a probe assistant used to measure compaction behaviour." }],
            source: { kind: "system-prompt" },
          },
        }, { surfaceOp: "append" })
      }
      s.append("user/message", {
        id: uid(uidCounter++, "8000"),
        role: "user",
        content: [{ type: "text", text: "Round " + round + " of a synthetic debugging transcript. " + filler.repeat(cfg.filler) }],
        source: { kind: "user" },
      }, { surfaceOp: "append" })
      s.append("assistant/message", {
        turn: round,
        step: 1,
        message: {
          id: uid(uidCounter++, "9000"),
          role: "assistant",
          content: [{ type: "text", text: "Acknowledged round " + round + ". " + filler.repeat(cfg.filler) }],
          source: { kind: "model", provider: cfg.provider, model: cfg.model },
        },
        stream: [],
      }, { surfaceOp: "append" })
      s.append("step/end", { turn: round, step: 1 })
      s.append("turn/end", { turn: round, reason: { kind: "completed" } })
    }
    await agent.whenIdle()
    out.steps.push({
      step: "history-appended",
      ...snap(),
      measure: measureOf(s),
      projection: projectionOf(s),
      activity: await activityNow(s.id),
    })

    const engine = presets.serviceFor(agent, "compaction")
    if (engine === undefined) { out.steps.push({ step: "serviceFor", error: "engine undefined after mount" }); return out }
    out.enginePrototype = Reflect.ownKeys(Object.getPrototypeOf(engine)).map(String).filter(k => k !== "constructor")

    const eventsBefore = s.snapshotEvents().map(e => ({ seq: e.seq, type: e.type }))
    out.before = {
      status: agent.status,
      eventCount: eventsBefore.length,
      surfaceNodes: s.surface.nodes.length,
      surfaceSeqs: s.surface.nodes.slice(),
      measure: measureOf(s),
      projection: projectionOf(s),
      activity: await activityNow(s.id),
    }

    if (cfg.race) {
      const registry = root.get("workspaceRegistry")
      const race = { steps: [] }
      const activity = []
      let release
      const gate = new Promise((resolve) => { release = resolve })
      const maintenance = agent.runMaintenance(async (signal) => {
        race.insideMaintenance = { status: agent.status, signalAborted: signal.aborted }
        release()
        await new Promise(r => setTimeout(r, 2500))
        return "maintenance-done"
      })
      await gate
      race.duringMaintenance = {
        status: agent.status,
        activity: await activityNow(s.id),
        inMaintenance: agent.status === "idle",
      }
      // (a) the admission gate WITHOUT stopActivity: this is the "is anything
      // running here?" question the registry asks before archiving.
      try {
        await registry.archiveSession(s.id)
        race.archiveWithoutStop = { ok: true, note: "admission did not refuse while maintenance held the agent" }
        try { await registry.unarchiveSession(s.id) } catch (error) { race.archiveWithoutStop.unarchiveError = String(error?.message).slice(0, 200) }
      } catch (error) {
        race.archiveWithoutStop = { ok: false, name: error?.name, message: String(error?.message).slice(0, 300) }
      }
      // (b) a second idle-window maintenance job while the first is in flight.
      let secondEngine
      try { secondEngine = presets.serviceFor(agent, "compaction") } catch { secondEngine = undefined }
      try {
        const second = await secondEngine.compactNow(agent, new AbortController().signal)
        race.secondCompactNow = { ok: true, result: second === null ? "null" : "non-null" }
      } catch (error) {
        race.secondCompactNow = { ok: false, name: error?.name, code: error?.code, sync: true, message: String(error?.message).slice(0, 300) }
      }
      // (c) the real retirement call: archive with stopActivity.
      try {
        await registry.archiveSession(s.id, { stopActivity: true })
        race.archive = { ok: true }
      } catch (error) {
        race.archive = { ok: false, name: error?.name, message: String(error?.message).slice(0, 300) }
      }
      race.afterArchive = {
        status: agent.status,
        archived: (() => { try { return registry.archivedSessionIds.map(String).includes(String(s.id)) } catch { return "ERR" } })(),
        activity: await activityNow(s.id),
      }
      try {
        const done = await maintenance
        race.maintenanceResult = done
      } catch (error) {
        race.maintenanceError = { name: error?.name, message: String(error?.message).slice(0, 300) }
      }
      race.afterMaintenance = { status: agent.status, activity: await activityNow(s.id) }
      // (d) is maintenance still ADMITTED on an archived session? A session whose
      // surface was never compacted still has a compactable range, so ask the
      // engine the cheap question instead: an agent with no surface returns null
      // without any model call. We reuse the same live agent, so instead just
      // observe that the archived id is still live and idle.
      race.archivedButLive = { inAgents: agents.list().map(a => String(a.id)).includes(String(s.id)), status: agent.status }
      try {
        await registry.unarchiveSession(s.id)
        race.unarchive = { ok: true }
      } catch (error) {
        race.unarchive = { ok: false, name: error?.name, message: String(error?.message).slice(0, 300) }
      }
      try {
        race.finalArchived = registry.archivedSessionIds.map(String).includes(String(s.id))
      } catch { race.finalArchived = "ERR" }
      out.race = race
      out.compactNow = { skipped: true, reason: "RACE=1" }
    } else if (cfg.skipCompact) {
      out.compactNow = { skipped: true, reason: "SKIP_COMPACT=1" }
    } else {
      // Sample the two predicates a handoff retirement reads, while compaction holds the agent.
      const samples = []
      let sampling = true
      const startedAt = Date.now()
      const sampleLoop = (async () => {
        while (sampling) {
          samples.push({
            atMs: Date.now() - startedAt,
            status: agent.status,
            activity: await activityNow(s.id),
          })
          await new Promise(r => setTimeout(r, cfg.sampleMs))
        }
      })()

      const ac = new AbortController()
      let outcome
      let threw
      try {
        const result = await engine.compactNow(agent, ac.signal)
        outcome = result === null ? { kind: "null" } : {
          kind: "compacted",
          keys: Object.keys(result),
          compactionId: String(result.compactionId),
          startSeq: result.startSeq,
          summarySeq: result.summarySeq,
          endSeq: result.endSeq,
          shadowedSeqs: Array.from(result.shadowedSeqs ?? []),
          shadowedRange: result.shadowedRange,
          shadowedTokenCount: result.shadowedTokenCount,
          summaryBlocks: Array.isArray(result.summary) ? result.summary.map(b => b.type) : null,
          summaryChars: Array.isArray(result.summary)
            ? result.summary.reduce((n, b) => n + (typeof b?.text === "string" ? b.text.length : 0), 0)
            : null,
        }
      } catch (error) {
        threw = { name: error?.name, code: error?.code, message: String(error?.message).slice(0, 400) }
      }
      const elapsedMs = Date.now() - startedAt
      sampling = false
      await sampleLoop

      const eventsAfter = s.snapshotEvents().map(e => ({ seq: e.seq, type: e.type }))
      const newEvents = eventsAfter.slice(eventsBefore.length)
      out.after = {
        status: agent.status,
        eventCount: eventsAfter.length,
        surfaceNodes: s.surface.nodes.length,
        surfaceSeqs: s.surface.nodes.slice(),
        measure: measureOf(s),
        projection: projectionOf(s),
        activity: await activityNow(s.id),
        newEventTypes: newEvents.map(e => e.type),
        newEventSeqs: newEvents.map(e => e.seq),
        compactionEvents: eventsAfter.filter(e => e.type.startsWith("compaction/")).map(e => ({ seq: e.seq, type: e.type })),
      }
      out.compactNow = { outcome, threw, elapsedMs, sampleCount: samples.length, samples }

      if (outcome?.kind === "compacted") {
        const summaryEvent = s.snapshotEvents().find(e => e.type === "compaction/summary" && e.seq === outcome.summarySeq)
        if (summaryEvent !== undefined) {
          out.summaryEvent = {
            provider: summaryEvent.data.provider,
            model: summaryEvent.data.model,
            maxTokens: summaryEvent.data.maxTokens ?? null,
            usage: summaryEvent.data.usage ?? null,
            shadowedTokenCount: summaryEvent.data.shadowedTokenCount,
            llmStreamCall: summaryEvent.data.llmStreamCall === true,
            shadowedSeqs: Array.from(summaryEvent.data.shadowedSeqs ?? []),
            summaryChars: Array.isArray(summaryEvent.data.summary)
              ? summaryEvent.data.summary.reduce((n, b) => n + (typeof b?.text === "string" ? b.text.length : 0), 0)
              : null,
          }
        }
      }
    }
  } catch (error) {
    out.steps.push({
      step: "probe",
      error: String(error?.message).slice(0, 400),
      stack: String(error?.stack ?? "").split("\n").slice(0, 5),
    })
  } finally {
    if (handle?.dispose) {
      try { await handle.dispose(); out.steps.push({ step: "dispose", ok: true }) } catch (error) { out.steps.push({ step: "dispose", error: String(error?.message).slice(0, 200) }) }
    }
    try { if (typeof stopStatusLog === "function") { stopStatusLog(); out.steps.push({ step: "status-hook-removed", ok: true }) } } catch {}
  }

  out.statusTransitions = statusLog
  try { out.hostAgentsAfter = agents.list().map(a => String(a.id)) } catch (error) { out.hostAgentsAfter = "ERR " + String(error?.message).slice(0, 120) }
  out.probeAgentLeftBehind = Array.isArray(out.hostAgentsAfter) ? out.hostAgentsAfter.includes(probeId) : null
  return out
})()`

const result = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
const payload = result.result?.value ?? { raw: result }
console.log(JSON.stringify(payload, null, 2))
socket.close()
