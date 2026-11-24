/** SH-10 success path: create an idle probe agent, mount the standard preset, then compact it.
 *  Only the /tmp probe session is touched; the probe is disposed at the end. */
const list = await (await fetch("http://127.0.0.1:9230/json/list")).json();
const socket = new WebSocket(list[0].webSocketDebuggerUrl);
let nextId = 1; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); socket.send(JSON.stringify({ id, method: m, params: p })); });
socket.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
await new Promise((r, j) => { socket.addEventListener("open", r, { once: true }); socket.addEventListener("error", j, { once: true }); });
await send("Runtime.enable");
const expr = String.raw`(async () => {
  const table = globalThis[Symbol.for("dsh.inspector.realm-object-registries")];
  let root;
  for (const registry of table.values()) for (const obj of registry.retained.values()) { try { if (obj?.root && obj?.registry && obj?.events) { root = obj.root; break; } } catch {} if (root) break; }
  const agents = root.get("agents");
  const presets = root.get("agentPresets");
  const out = { steps: [] };
  const id = "session-probe-compact-" + Date.now().toString(36);
  let handle, agent;
  try {
    handle = await agents.create({ sessionId: id, meta: { cwd: "/tmp/sh10-probe", agentPreset: "standard" } });
    agent = handle.agent ?? handle;
  } catch (error) { out.steps.push({ step: "create", error: String(error?.message).slice(0,200) }); return out; }
  try {
    await presets.mount(agent.ctx, "standard");
    await agent.whenIdle();
    const engine = presets.serviceFor(agent, "compaction");
    out.steps.push({ step: "ready", status: agent.status, engine: typeof engine, compactNow: typeof engine?.compactNow });
    const eventsBefore = agent.session.snapshotEvents ? agent.session.snapshotEvents().length : -1;
    const ac = new AbortController();
    try {
      const result = await engine.compactNow(agent, ac.signal);
      out.steps.push({
        step: "compactNow",
        outcome: result === null ? "null: no compactable range" : "compacted",
        result: result === null ? null : { summarized: result.summarized, pruned: result.pruned, keys: Object.keys(result ?? {}) },
        eventsBefore,
        eventsAfter: agent.session.snapshotEvents ? agent.session.snapshotEvents().length : -1,
        status: agent.status,
      });
    } catch (error) {
      out.steps.push({ step: "compactNow", threw: true, name: error?.name, code: error?.code, message: String(error?.message).slice(0, 260), status: agent.status });
    }
  } finally {
    if (handle?.dispose) { try { await handle.dispose(); out.steps.push({ step: "dispose", ok: true }); } catch (e) { out.steps.push({ step: "dispose", error: String(e?.message).slice(0,150) }); } }
  }
  return out;
})()`;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(r.result?.value ?? r, null, "\t").slice(0, 4000));
socket.close();
