const list = await (await fetch("http://127.0.0.1:9230/json/list")).json();
const socket = new WebSocket(list[0].webSocketDebuggerUrl);
let nextId = 1; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); socket.send(JSON.stringify({ id, method: m, params: p })); });
socket.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
await new Promise((r, j) => { socket.addEventListener("open", r, { once: true }); socket.addEventListener("error", j, { once: true }); });
await send("Runtime.enable");

const expr = String.raw`(() => {
  const table = globalThis[Symbol.for("dsh.inspector.realm-object-registries")];
  if (!(table instanceof Map)) return { error: "no registry table" };
  const out = { registries: table.size, retained: [] };
  for (const registry of table.values()) {
    const map = registry.retained;
    if (!(map instanceof Map)) { out.retained.push("no retained map"); continue; }
    for (const [handle, obj] of map) {
      let kind = typeof obj;
      let keys = [];
      try { keys = Reflect.ownKeys(obj).map(String).slice(0, 14); } catch {}
      out.retained.push({ handle: String(handle), kind, keys });
    }
  }
  out.retained = out.retained.slice(0, 40);
  return out;
})()`;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(JSON.stringify(r.result?.value ?? r, null, "\t").slice(0, 5000));
socket.close();
