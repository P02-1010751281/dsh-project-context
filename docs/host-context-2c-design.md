# Phase 2c: the registration façade (`HostContext`)

Status: first slice landed in the working tree (not committed). The façade and the dsh adapter are
in place, and `project-context` is ported. `project-memory`, `project-autolearn` and
`project-handoff` are not ported yet; their edit lists are in §5.

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

export interface HostContext {
	on<K extends keyof HostEvents>(name: K, listener: HostEvents[K]): void;
	registerCommand(command: CommandRegistration): void;
	addPromptContext(contribution: PromptContribution): void;
	onDispose(cleanup: () => void, label?: string): void;
	readonly log: HostLog;
	readonly services: ServiceRegistry;
}
```

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

**project-memory** (`src/project-memory/index.ts`)
- Five `ctx.on` calls → `host.on`. One `ctx.commands.register` → `host.registerCommand`.
- `registerLiteralContext` → `host.addPromptContext({..., interpolate: false})`, and delete the local
  `LiteralContext` type (the adapter now owns the `interpolate` widening).
- `logOf(ctx)` → `host.log`.
- `consolidateProject(ctx, …)` and `writeTodoSnapshot(ctx, …)` take a `Context`. Change their
  parameter to a narrower port, either `HostContext` or `{ services, log }` plus the LLM port. This
  touches `update.ts`, `consolidate.ts` and `src/shared/model-call.ts` (`llmOf(ctx)`).
- About 84 test call sites pass fake contexts with `{ get, logger, llm }`. The ported signatures
  must accept those, or the fakes must be wrapped.

**project-autolearn** (`src/project-autolearn/index.ts`)
- Three `ctx.on` calls and one `ctx.commands.register`. Five `logOf(ctx)` calls → `host.log`.
- `autolearnProjectSkills(ctx, …)` (`pass.ts`) needs `llmOf(ctx)`. That requires an LLM member on
  the façade (§6) or a separate port argument. Tests call it 43 times with fakes.

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

1. **LLM.** `llmOf(ctx)` (`src/host/dsh/llm.ts`) is not on the façade yet. The port types are
   host-neutral already, so adding `readonly llm: LlmPort` to `HostContext` (with the chunk types
   moved into the contract) closes this gap.
2. **Settings publication.** The live config reader depends on the cordis Loader's `fiber.config`.
   A second harness needs its own way to read config updates; today that lives in the entry.
3. **Service getters.** `src/host/dsh/services.ts` maps dsh service names to the `*Like` views.
   Those views and their getters would move into the contract as an interface (for example
   `HostServices`) so that a second adapter supplies them. Today the getters are dsh functions over
   `{ get }`.
4. **Plugin descriptor.** `name`, `inject` and `Config` are cordis plugin metadata and stay in each
   entry. A second harness writes its own entry files, which call the same `start(host, entry)`
   functions.
5. **Event semantics.** `HostEvents` fixes names and payloads, not timing. For example, the cores
   rely on `session/flush` arriving before a request names the session, and on `agent/status` idle
   after settle. A second adapter must emulate this ordering, and it is documented only in the cores.

## 7 Doc anchors invalidated by this slice

Moving the body of `apply` shifts `path:line` anchors in `docs/architecture.md` and
`docs/GLOSSARY.md`. Those files belong to the lead, so the closing report lists the new targets.
