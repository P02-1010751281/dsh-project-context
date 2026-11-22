# Phase 2c: the registration façade (`HostContext`)

Status: three slices landed (2026-11-22). The façade and the dsh adapter are in place; `HostContext`
extends `HostPorts`, and `ServiceHost` is the one-member port for a helper that only reads a named
service. `project-context`, `project-autolearn` and `project-memory` are ported. `project-handoff` is
not; its edit list is in §5.

## 1 The façade

The façade is declared at the bottom of `src/host/contract.ts`. It names no framework type, so a
second harness can implement it from that file alone.

```ts
export type AgentStatus = "idle" | "running";

export interface HostEvents {
	"agent/created"(payload: { readonly agent: Agent }): undefined;
	"agent/status"(payload: { readonly agent: Agent; readonly status: AgentStatus }): void;
	"agent/disposed"(payload: { readonly agent: Agent }): void;
	"session/event"(session: Session, event: EventEnvelope): void;
	"session/flush"(session: Session): Promise<void> | void;
	"session/disposed"(session: Session): void;
}

export type CommandResult =
	| { readonly kind: "success"; readonly text?: string }
	| { readonly kind: "error"; readonly text: string };
export interface CommandInvocation { readonly agent: Agent; readonly rawInput: string; readonly signal: AbortSignal }
export interface CommandRegistration {
	readonly name: string;
	readonly description: string;
	readonly input?: { readonly hint: string };
	readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}

export interface PromptAssembly { readonly agent?: Agent }
export interface PromptContribution {
	readonly name: string;
	readonly order: number;
	readonly interpolate?: boolean;
	readonly text: string | ((assembly: PromptAssembly) => string);
}

export interface HostLog { info(format: string, ...args: readonly unknown[]): void; warn(format: string, ...args: readonly unknown[]): void }
export interface ServiceRegistry { get(name: string): unknown }

/** The facilities a core reads besides registration. */
export interface HostPorts {
	readonly log: HostLog;
	readonly services: ServiceRegistry;
	readonly llm: LlmPort;
}

/** A helper that reads nothing but a named service (a projection read, say). */
export interface ServiceHost {
	readonly services: ServiceRegistry;
}

export interface HostContext extends HostPorts {
	on<K extends keyof HostEvents>(name: K, listener: HostEvents[K]): void;
	registerCommand(command: CommandRegistration): void;
	addPromptContext(contribution: PromptContribution): void;
	onDispose(cleanup: () => void, label?: string): void;
}
```

`LlmPort` and its reply-chunk union are declared in `contract.ts` next to `GenerateOptions` (§6
item 1 closed), and `src/shared/model-call.ts` takes the port rather than a context.

Design rules:

- **Subset only.** The event list is the six events the four entries subscribe to today. The
  payloads carry only the fields the listeners read. `agent/created` drops `source` and `signal`,
  and the command invocation drops `commandId` and `attachments`.
- **Plugin-lifetime ownership.** None of the registrations returns a disposer. The adapter ties
  each one to the plugin instance, and today no core unregisters anything by hand.
- **Services stay behind the named getters.** `host.services` is the `{ get }` that
  `src/host/dsh/services.ts` already accepts (`ServiceRegistry`). A core passes `host.services` to
  `tokenMeterOf(...)` and the other getters; it never asks for a service by name. The boundary
  rule `service-access` still forbids `ctx.get` outside `src/host/`.
- **`HostLog` moved into the contract.** `src/host/dsh/log.ts` re-exports it, so existing importers
  keep working.
- **Three narrowing levels.** A core that registers takes `HostContext`; a helper deeper down that
  logs, looks up a service or calls the model takes `HostPorts`; one that reads only a service takes
  `ServiceHost`. `HostContext extends HostPorts`, and both are satisfied by the same object, so the
  entry passes it down without rebuilding anything.

## 2 The dsh adapter

`src/host/dsh/host-context.ts` exports `hostContextOf(ctx: Context): HostContext`. Each method
forwards to the cordis call that the entry used to make itself:

| Façade | Forwards to |
|---|---|
| `on(name, listener)` | `ctx.on(name, listener)` |
| `registerCommand(c)` | `ctx.commands.register(c)` |
| `addPromptContext(p)` | `ctx.systemPrompt.context(p)` |
| `onDispose(fn, label)` | `onDispose(ctx, fn, label)` (`lifecycle.ts`) |
| `log` | `logOf(ctx)`, read on each access |
| `services` | `ctx` itself |
| `llm` | `llmOf(ctx)`, read on each access — the one widening (`as unknown as`), so no core casts |

Registrations are made on the same fiber with the same arguments, in the same order, so the plugin
behaves exactly as before. The tests' fake contexts keep working unchanged because the adapter calls
the same members on them.

The mapping is checked at compile time:

- `ListenerFits` requires every `HostEvents[K]` to be assignable to cordis `Events[K]`.
- `commandDefinition` requires a `CommandRegistration` to be assignable to dsh's
  `CommandDefinition`.
- `promptContext` requires a `PromptContribution` to be assignable to dsh's `PromptContext` plus
  `interpolate`.

If dsh changes a payload so that a core would read a field the host no longer sends, the adapter
stops compiling. A core would not find out at runtime.

## 3 What moved

| File | Change |
|---|---|
| `src/host/contract.ts` | Adds the façade (§1). The header comment now describes the façade. |
| `src/host/dsh/host-context.ts` | New file: `hostContextOf` plus the three compile-time checks. |
| `src/host/dsh/log.ts` | `HostLog` is now imported from the contract and re-exported. |
| `src/project-context/start.ts` | New file: the core. `start(host: HostContext, entry: PluginConfig)` holds the former body of `apply`, with `ctx.on` → `host.on` (6 calls) and `ctx.commands.register` → `host.registerCommand` (2 calls). It imports no cordis type. |
| `src/project-context/index.ts` | Now a thin entry: `name`, `inject` and `Config` are unchanged, and `apply(ctx, raw)` runs `resolvePluginConfig` → `publishProjectContextSettings(ctx, entry)` → `start(hostContextOf(ctx), entry)`. |
| `src/project-autolearn/start.ts` | New file: the former body of `apply`, now `start(host: HostContext, entry)`. Three `host.on` calls and one `host.registerCommand`. |
| `src/project-autolearn/index.ts` | Thin entry: `name`, `inject` and `apply` → `start(hostContextOf(ctx), resolvePluginConfig(raw))`. |
| `src/project-autolearn/pass.ts` | `autolearnProjectSkills(ports: HostPorts, …)`; the log line and the two model calls read `ports.log` / `ports.llm`, so the module names no `Context`. |
| `src/host/dsh/llm.ts` | `LlmPort` and the chunk union now come from the contract; the file owns the single `ctx.llm` widening plus `llmOf`. |
| `src/shared/model-call.ts` | `resolveModelMetadata` / `requestPluginText(WithMeta)` take an `LlmPort`, not a context. The memory pass passes `llmOf(ctx)` until it is ported. |
| `src/project-memory/start.ts` | New file (278 lines): the former body of `apply` as `start(host, entry)` — two `host.addPromptContext` (orders 190 / 210, `interpolate: false`), five `host.on`, one `host.registerCommand`. |
| `src/project-memory/index.ts` | Thin entry (40 lines): `name`, `inject`, the unchanged re-export surface, and `apply` → `start(hostContextOf(ctx), resolvePluginConfig(raw))`. It publishes no settings namespace, so `publishProjectContextSettings` does not appear here. |
| `src/project-memory/update.ts` | `consolidateProject(host: HostPorts, …)`; the two log lines read `host.log`, the projection read `projectionsOf(host.services)`. |
| `src/project-memory/consolidate.ts` | `consolidateProjectState(host: HostPorts, …)` and `requestConsolidationText(host, …)`; the `llmOf` import is gone — the pass calls `host.llm`. |
| `test/host-ports.mjs` | New fixture: `portsOf(ctx)` returns `{ get log, get llm, services: ctx }`, the same lazy shape as the adapter, so a direct helper call takes one wrapper instead of a hand-built fake. |
| `scripts/check-boundary.mjs` | New `raw-context` rule under `wiring`: a ported core (`src/<plugin>/start.ts`) must not import the raw `Context`. |
| `scripts/check-boundary.mjs` | Adds the rule in §4. |
| `test/host-boundary.test.mjs` | Adds two cases: a fail fixture and a pass fixture. |
| `test/routing-skill.test.mjs` | `registeredCommands()` now reads every `.ts` file in a `project-*` directory and matches both `ctx.commands.register({name` and `host.registerCommand({name`. Before, it read only `index.ts`. |

`publishProjectContextSettings` stays in the entry because it reads `ctx.fiber.config`, which is the
cordis Loader's live config. This is the single framework-specific step of `project-context`.

## 4 Gate rule

The existing `wiring` rule still holds as written. `ctx.on`, `ctx.commands` and `ctx.systemPrompt`
appear only in plugin `index.ts` files. The cores now call `host.*`, which the rule does not match,
and that is the intended direction: a core registers only through the façade it is handed.

One check was added under the same rule id (`scripts/check-boundary.mjs`, `FACADE_BUILD`). A
`hostContextOf(` call outside a plugin `index.ts` and outside `src/host/` fails with:

```
FAIL wiring: <file> calls hostContextOf; only a plugin's index.ts adapts the harness context, a core receives the HostContext
```

Fixtures:

- `a core module building the host façade itself fails`: the red direction.
- `a core registering through the façade it was handed is allowed, and the entry builds it`: the
  green direction.

Mutation check: with the new loop disabled, only the red fixture fails (10 pass, 1 fail).

Recommended wording change for RULES.md 4.6 (the lead edits that file):

> 事件、命令与提示词注册只在各插件 `index.ts` 经 `ctx.*` 发生，或在核心里经入口交来的
> `HostContext`（`host.on` / `host.registerCommand` / `host.addPromptContext`）发生；
> `hostContextOf(ctx)` 只在插件 `index.ts` 调用。

When all four plugins are ported (§5), a stronger rule becomes possible: forbid `ctx.on`,
`ctx.commands` and `ctx.systemPrompt` in `index.ts` too, which leaves `src/host/<harness>/` as the
only place that names them. Turning that rule on today would make the three unported entries fail.

## 5 Remaining three plugins: edit list

Each port follows the `project-context` pattern. Move the body of `apply` into `start.ts`, keep the
`name` / `inject` exports and config resolution in `index.ts`, and add `start(hostContextOf(ctx), entry)`.

**project-memory** — ported 2026-11-22. `apply` body moved to `start.ts` (278 lines, two
`addPromptContext`, five `host.on`, one `host.registerCommand`); `consolidateProject` /
`consolidateProjectState` / `requestConsolidationText` take `HostPorts`, `writeTodoSnapshot` takes the
new `ServiceHost`. The 84 direct-helper call sites did not get field-by-field fakes: `test/host-ports.mjs`
adds one lazy `portsOf(ctx)` wrapper, so every `apply()`-driven fake stayed untouched. `index.ts`
keeps the whole former re-export surface, because other modules and the suite import from it.

**project-autolearn** — ported 2026-11-22. Three `ctx.on` + one `ctx.commands.register` moved into
`start.ts`; `pass.ts` takes `HostPorts` and reads `ports.log` / `ports.llm`. The direct-call fakes in
`test/autolearn.test.mjs` gained a `log` field; the `apply()` fakes did not change, because the
adapter still reads `logger` / `llm` off the context they stand in for.

**project-handoff** (`src/project-handoff/index.ts`)
- Two `ctx.on` calls, one `ctx.commands.register`, and one `ctx.systemPrompt.context` →
  `host.addPromptContext`.
- About 12 helpers take a `Context`: `maybeAutoHandoff`, `resolveHandoffGate`, `runManual`,
  `statusText`, `writeSetting`, `relabelHandoffChild`, `retireIfPending`, `createChildSession`,
  `seedChildSession`, `carryPermissionPreset`, `pendingSubagentWork` and `performHandoff`. Today
  they use it only for the service getters, `logOf` and `llmOf`, so each can take
  `ServiceRegistry & { log }` plus the LLM port. This is the largest port, and memory says
  `performHandoff` must not be split.
- `movesThreshold` and the re-exports stay in `index.ts`.

`src/shared/settings.ts`: `publishProjectContextSettings(ctx, …)` stays an entry-only call (it uses
`ctx.fiber`). `onDispose` could move to `host.onDispose`, but the fiber read cannot.

## 6 Gap to a real second adapter

1. ~~**LLM.**~~ Closed 2026-11-22: `HostPorts.llm` is an `LlmPort`, the chunk union and the request
   vocabulary live in the contract, and `src/host/dsh/llm.ts` owns the single widening.
2. **Settings publication.** The live config reader depends on the cordis Loader's `fiber.config`.
   A second harness needs its own way to read config updates; today that lives in the entry.
3. **Service getters.** Partly open. `ServiceHost` in the contract is the port a helper takes, but
   the twelve getters themselves are still dsh functions over `{ get }` in
   `src/host/dsh/services.ts`. Moving them into the contract as `HostServices` would let a second
   adapter supply them; `ServiceHost` is deliberately not that name.
4. **Plugin descriptor.** `name`, `inject` and `Config` are cordis plugin metadata and stay in each
   entry. A second harness writes its own entry files, which call the same `start(host, entry)`
   functions.
5. **Event semantics.** `HostEvents` fixes names and payloads, not timing. For example, the cores
   rely on `session/flush` arriving before a request names the session, and on `agent/status` idle
   after settle. A second adapter must emulate this ordering, and it is documented only in the cores.

## 7 Doc anchors invalidated by this slice

Moving the body of `apply` shifts `path:line` anchors in `docs/architecture.md` and
`docs/GLOSSARY.md`. Those files belong to the lead, so the closing report lists the new targets.
