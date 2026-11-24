/** Read-only SH-10 runtime probe: reach the live cordis root through the Inspector's retained
 *  object registry, then report what a plugin could actually see at this moment. Nothing compacts:
 *  `compactNow` is only inspected (typeof), never invoked, so no model call can happen. */
const list = await (await fetch("http://127.0.0.1:9230/json/list")).json();
const socket = new WebSocket(list[0].webSocketDebuggerUrl);
let nextId = 1; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); socket.send(JSON.stringify({ id, method: m, params: p })); });
socket.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
await new Promise((r, j) => { socket.addEventListener("open", r, { once: true }); socket.addEventListener("error", j, { once: true }); });
await send("Runtime.enable");

const expr = String.raw`(() => {
  const table = globalThis[Symbol.for("dsh.inspector.realm-object-registries")];
  const out = { root: "not found", rootServices: [], agentsApi: null, agents: [], presetsApi: null, perAgent: [], hostPlane: {} };
  let root;
  for (const registry of table.values()) {
    for (const obj of registry.retained.values()) {
      try { if (obj && obj.root && obj.registry && obj.events) { root = obj.root; break; } } catch {}
    }
    if (root) break;
  }
  if (!root) return out;
  out.root = "found";
  // The service table is keyed by service name; report names only, never instances' internals.
  try { out.rootServices = Reflect.ownKeys(root.registry ?? {}).map(String).slice(0, 80); } catch (e) { out.rootServices = ["ERR " + e.message]; }
  const get = (name) => { try { return root.get(name); } catch { return undefined; } };

  // Host-plane rows the web-app patch disables: they must be unreachable from the root.
  for (const name of ["compaction", "commandCompact", "tokenMeter", "sessions", "agents", "agentPresets"]) {
    let value;
    try { value = get(name); } catch (e) { value = undefined; }
    out.hostPlane[name] = value === undefined ? "undefined" : typeof value;
  }
  // The compaction engine, if the root could see one, is what a naive wiring would use.
  let engine;
  try { engine = get("compaction"); } catch {}
  out.hostPlane.compactNowOnRoot = engine === undefined ? "no engine on root" : typeof engine.compactNow;

  const agents = get("agents");
  out.agentsApi = agents === undefined ? null : Reflect.ownKeys(agents).map(String).slice(0, 20);
  if (agents && typeof agents.list === "function") {
    let rows = [];
    try { rows = agents.list() ?? []; } catch (e) { rows = []; }
    out.agents = rows.slice(0, 10).map((a) => {
      let status = "?", id = "?";
      try { status = a.status; } catch {}
      try { id = String(a.id).slice(0, 8); } catch {}
      return { id, status, hasWhenIdle: typeof a.whenIdle === "function", hasRunMaintenance: typeof a.runMaintenance === "function", hasCtx: !!a.ctx };
    });
  }
  const presets = get("agentPresets");
  out.presetsApi = presets === undefined ? null : Reflect.ownKeys(presets).map(String).filter((k) => typeof presets[k] === "function").slice(0, 12);
  if (presets && typeof presets.serviceFor === "function" && agents && typeof agents.list === "function") {
    for (const a of (agents.list() ?? []).slice(0, 6)) {
      let engineForAgent;
      try { engineForAgent = presets.serviceFor(a, "compaction"); } catch (e) { engineForAgent = "ERR " + e.message; }
      out.perAgent.push({
        id: String(a.id).slice(0, 8),
        status: a.status,
        viaServiceFor: engineForAgent === undefined ? "undefined" : (typeof engineForAgent === "string" ? engineForAgent : "engine(" + typeof engineForAgent.compactNow + ")"),
      });
    }
  }
  return out;
})()`;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(JSON.stringify(r.result?.value ?? r, null, "\t"));
socket.close();
