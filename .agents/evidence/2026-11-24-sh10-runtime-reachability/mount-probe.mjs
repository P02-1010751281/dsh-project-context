/** Does a freshly created agent get a preset mount (and therefore an engine)? Read-only w.r.t. the
 *  user's session; the probe agent is disposed even when a step throws. */
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
  const id = "session-probe-mount-" + Date.now().toString(36);
  let handle, agent;
  try {
    handle = await agents.create({ sessionId: id, meta: { cwd: "/tmp/sh10-probe", agentPreset: "standard" } });
    agent = handle.agent ?? handle;
    const snap = () => {
      let composed, gen;
      try { composed = presets.composedPreset(agent.ctx); } catch (e) { composed = "ERR"; }
      try { const g = presets.generationFor(agent.ctx); gen = g === undefined ? "undefined" : (g.mount === undefined ? "gen-no-mount" : "gen-with-mount"); } catch (e) { gen = "ERR"; }
      let engine; try { engine = presets.serviceFor(agent, "compaction"); } catch { engine = undefined; }
      return { status: agent.status, composed, gen, engine: engine === undefined ? "undefined" : typeof engine };
    };
    out.steps.push({ step: "after create", ...snap() });
    // The mount may be keyed on session enter rather than create; try the documented binding path.
    for (const method of ["activate", "bind", "mount", "select"]) {
      if (typeof presets[method] !== "function") continue;
      try {
        const r = await presets[method](method === "mount" ? agent.ctx : agent, "standard");
        out.steps.push({ step: method, ok: true, returned: typeof r === "string" ? r : typeof r });
      } catch (e) { out.steps.push({ step: method, error: String(e?.message).slice(0, 150) }); }
      out.steps.push({ step: method + " -> snap", ...snap() });
      if (snap().engine !== "undefined") break;
    }
  } catch (error) {
    out.steps.push({ step: "create", error: String(error?.message).slice(0, 200) });
  }
  if (handle?.dispose) { try { await handle.dispose(); out.steps.push({ step: "dispose", ok: true }); } catch (e) { out.steps.push({ step: "dispose", error: String(e?.message).slice(0,150) }); } }
  return out;
})()`;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(r.result?.value ?? r, null, "\t").slice(0, 4000));
socket.close();
