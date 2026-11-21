import { apply } from "/mnt/Data/Projects/dsh-project-context/lib/project-memory/index.js";
import { publishProjectContextSettings } from "/mnt/Data/Projects/dsh-project-context/lib/shared/settings.js";
import { resolvePluginConfig } from "/mnt/Data/Projects/dsh-project-context/lib/shared/config.js";
// The host's effective config: the profile carries maxMemoryChars 52000, not the 40000 default.
publishProjectContextSettings({ effect: () => undefined }, resolvePluginConfig({ maxMemoryChars: 52_000, maxOutputTokens: 49_152 }));
let handler;
apply({
  logger: { info() {}, warn() {} },
  systemPrompt: { context: () => undefined },
  on: () => () => undefined,
  commands: { register: (r) => { handler = r.handler; } },
}, { memoryEnabled: true });
const agent = { session: { header: { cwd: "/mnt/Data/Projects/dsh-project-context" } } };
const reply = await handler({ agent, rawInput: "reconcile", signal: undefined });
console.log("kind:", reply.kind);
console.log(reply.text);
