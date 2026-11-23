/**
 * The host contract — the only vocabulary the cores may name.
 *
 * Everything under `src/` outside `src/host/` reads host objects through the shapes declared here, so a
 * second harness can satisfy them by mapping, without the cores branching on the host. The contract is
 * host-neutral: it names no harness package, and `scripts/check-boundary.mjs` fails the repository if
 * it does.
 *
 * Every interface below is the subset the cores **name** — a member earns its place by being read,
 * written or forwarded by a core or by the adapter on a core's behalf, attributed with the type
 * checker rather than copied from the host's declaration. A member nothing names is absent on
 * purpose: adding one "for completeness" would make a second harness provide something nothing
 * consumes. (An output shape qualifies: `GenerateOptions` is built by the adapter from these fields,
 * and a message's `id` is written by the core that constructs it.) The dsh adapter (`src/host/dsh/`)
 * owns the mapping; where a dsh object
 * already satisfies a shape structurally — the session, the agent, every message and event the host
 * hands a core — no runtime wrapper exists and the assignability is checked wherever the host passes
 * one in.
 *
 * Four shapes are open-ended on the host side: the event log, the content-block list, the stream
 * chunk union and the finish-reason kinds all grow when a host package adds an entry. They are
 * modeled as a closed union of the members the cores narrow on plus one *opaque* member whose
 * `type` names are declared by the adapter, through the {@link OpaqueEventTypes} /
 * {@link OpaqueBlockTypes} / {@link OpaqueChunkTypes} / {@link OtherFinishKinds} registries. That
 * keeps `event.type === "…"` a real discriminant for the cores while every host event, block,
 * chunk or finish kind stays assignable.
 *
 * Registration goes through {@link HostContext} at the bottom of this file (phase 2c of
 * `docs/core-host-boundary.md`): a plugin entry adapts its harness context once and hands the core a
 * `HostContext`, so a core subscribes, registers and logs without naming the framework. `Context` is
 * still re-exported for the cores not yet moved behind the façade; see
 * `docs/host-context-2c-design.md` for which ones.
 */

export type { Context } from "./dsh/types.js";
// Pure predicates over the event vocabulary: values, not host types, so the contract may re-export
// them without naming a harness package (the gate only forbids `@deepseek-ai/*` here).
export { isReplacementSurfaceEvent, isSurfaceEligibleType } from "./dsh/types.js";

// ── Content blocks ────────────────────────────────────────────────────────────────────────────────

/** A text block; `text` is the only payload a core reads (`textOf`). */
export interface TextBlock {
	readonly type: "text";
	readonly text: string;
}

/** A tool call the model made; its raw JSON arguments are parsed by the cores that need them. */
export interface ToolCallBlock {
	readonly type: "tool-call";
	readonly id: string;
	readonly name: string;
	readonly arguments: string;
}

/**
 * Block kinds a host emits that no core reads. A harness adapter adds its own names here by
 * interface merging (`declare module "../contract.js"`); the value type is irrelevant.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface OpaqueBlockTypes {}

/** Any block the cores only skip over: they read its `type` and nothing else. */
export interface OpaqueBlock {
	readonly type: keyof OpaqueBlockTypes;
}

export type ContentBlock = TextBlock | ToolCallBlock | OpaqueBlock;

// ── Messages ──────────────────────────────────────────────────────────────────────────────────────

/** Who produced a message; the cores branch on `kind` (`user`, `tool`, a plugin's own kind). */
export interface MessageSource {
	readonly kind: string;
}

interface MessageBase {
	/** Stable identity the host assigns; auxiliary-call messages carry their own. */
	readonly id: string;
	readonly content: readonly ContentBlock[];
	readonly source: MessageSource;
}

export interface SystemMessage extends MessageBase {
	readonly role: "system";
}

export interface DeveloperMessage extends MessageBase {
	readonly role: "developer";
}

export interface UserMessage extends MessageBase {
	readonly role: "user";
}

export interface AssistantMessage extends MessageBase {
	readonly role: "assistant";
}

export interface ToolResultMessage extends MessageBase {
	readonly role: "tool";
	/** The `ToolCallBlock.id` this result answers. */
	readonly toolCallId: string;
	readonly isError?: boolean;
}

/** One model-visible message, discriminated by `role`. */
export type Message = SystemMessage | DeveloperMessage | UserMessage | AssistantMessage | ToolResultMessage;

// ── Model calls ───────────────────────────────────────────────────────────────────────────────────

/** One tool offered to a plugin-authored call: the declaration the adapter forwards to the provider. */
export interface PluginTool {
	readonly name: string;
	readonly description: string;
	/** JSON Schema object for the arguments. */
	readonly parameters: Record<string, unknown>;
}

/**
 * One user input as a request carries it: identity-free and text-only.
 *
 * A request is one prompt for one auxiliary call, and the host's own one-shot request shape
 * carries no durable identity — `id` and `source` belong to the session log, not to a request —
 * so a request message has neither. An opaque block is not representable either: {@link OpaqueBlock}
 * carries only its `type`, so a request that meant to send one could not be reconstructed for the
 * host; this port's producer (`src/shared/model-call.ts`) sends exactly one text block.
 */
export interface RequestUserMessage {
	readonly role: "user";
	readonly content: readonly TextBlock[];
}

/** The request one auxiliary call sends: exactly the fields `requestPluginTextWithMeta` sets. */
export interface GenerateOptions {
	provider: string;
	model: string;
	/** The live session this call routes on; a route may refuse a request without it. */
	sessionId: string;
	messages: readonly RequestUserMessage[];
	maxTokens?: number;
	reasoningEffort?: string;
	tools?: PluginTool[];
	signal?: AbortSignal;
}

/** The route metadata the passes read: context capacity, default output cap, reasoning efforts. */
export interface LlmResolvedModelInfo {
	readonly context?: { readonly contextWindow: number };
	readonly defaultMaxTokens?: number;
	readonly reasoning?: { readonly efforts: readonly { readonly id: string }[] };
}

/** One text delta of a streamed reply. */
export interface TextDeltaChunk {
	readonly type: "text-delta";
	readonly text: string;
}

/** One fragment of a streamed tool call; the arguments arrive in pieces. */
export interface ToolCallDeltaChunk {
	readonly type: "tool-call-delta";
	readonly index: number;
	/** Only the first delta of a block names the tool. */
	readonly name?: string;
	readonly argumentsDelta: string;
}

/** The assembled end of one content block, authoritative when it arrives. */
export interface BlockEndChunk {
	readonly type: "block-end";
	readonly index: number;
	/** The assembled block; the reply loop reads only the tool-call one and skips the rest. */
	readonly block: ContentBlock;
}

/** A usage report for the reply so far. */
export interface UsageChunk {
	readonly type: "usage";
	readonly usage: { readonly reasoningTokens?: number };
}

/** The failure an error or an abort carries: the host's machine-routable code plus its message. */
export interface FinishFailure {
	readonly message: string;
	readonly code: string;
}

/**
 * Finish kinds that carry no failure.
 *
 * A harness adapter closes this with its own remaining kinds (`src/host/dsh/types.ts`), which keeps
 * the two failure kinds below the only ones that require a `failure` — the reply loop reads it
 * there and nowhere else — while a provider-specific kind stays assignable.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface OtherFinishKinds {}

/** Why a reply ended; a failure is present exactly on the `error` and `aborted` kinds. */
export type FinishReason =
	| { readonly kind: "error" | "aborted"; readonly failure: FinishFailure }
	| { readonly kind: keyof OtherFinishKinds };

/** How the reply ended, with the failure an error or an abort carries. */
export interface FinishChunk {
	readonly type: "finish";
	readonly reason: FinishReason;
}

/**
 * Chunk kinds a harness emits that no core narrows on. A harness adapter closes this by interface
 * merging (`src/host/dsh/types.ts`); the value type is irrelevant.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface OpaqueChunkTypes {}

/** Any streamed chunk the cores only skip over: they read its `type` and nothing else. */
export interface OpaqueChunk {
	readonly type: keyof OpaqueChunkTypes;
}

/** One streamed reply event: the vocabulary the reply loop narrows on, declared here rather than borrowed. */
export type StreamChunk = TextDeltaChunk | ToolCallDeltaChunk | BlockEndChunk | UsageChunk | FinishChunk | OpaqueChunk;

/**
 * The model port: the two calls a core makes, named host-neutrally.
 *
 * An adapter maps its own service onto this, and a mapping mismatch is a loud adapter failure rather
 * than a silently faked reply. `src/shared/model-call.ts` is the single consumer.
 */
export interface LlmPort {
	/** Resolve one route's catalogue metadata; a failing route rejects rather than guessing. */
	resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
	/** Stream one reply for `options`. */
	stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

// ── Session events ────────────────────────────────────────────────────────────────────────────────

/**
 * Event types a host logs that the cores never narrow on. A harness adapter adds its own names here
 * by interface merging; the value type is irrelevant.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface OpaqueEventTypes {}

interface EventBase {
	/** Monotonic position within the session's log. */
	readonly seq: number;
	/** Unix epoch milliseconds. */
	readonly time: number;
	/**
	 * Present when this event joined the model-visible surface: `"append"` for a node that entered at
	 * its own log position, a replacement marker otherwise. The cores read it for one decision — whether
	 * a logged event is an append-origin record or a copy that shadowed an earlier range
	 * (`isReplacementSurfaceEvent` in the adapter mirrors the host's two-line test).
	 */
	readonly surfaceOp?: unknown;
}

/** A user-role message entering the log; the one event whose payload the cores read typed. */
export interface UserMessageEvent extends EventBase {
	readonly type: "user/message";
	readonly data: UserMessage;
}

/** Any other logged event: the cores read its `type`, `seq` and `time`, and its payload only as data. */
export interface OpaqueEvent extends EventBase {
	readonly type: keyof OpaqueEventTypes;
	readonly data: unknown;
}

/** One entry of a session's durable log, discriminated by `type`. */
export type EventEnvelope = UserMessageEvent | OpaqueEvent;

// ── Session and agent ─────────────────────────────────────────────────────────────────────────────

/** The session's durable header: the fields the archive, the index and the project root read. */
export interface SessionHeader {
	readonly version: number;
	readonly createdAt: number;
	readonly cwd?: string;
	readonly parentSession?: string;
	readonly isSeeded: boolean;
	/** `subagent` for a delegated child; absent for a top-level session. */
	readonly origin?: string;
	readonly agentPreset?: string;
}

/** The route the session's latest request was sent on. */
export interface RequestHeader {
	readonly config: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string };
}

/** The session view: identity, header, the durable log and the derived conversation. */
export interface Session {
	readonly id: string;
	readonly header: SessionHeader;
	/** The route of the latest logged request, or `undefined` before the first one. */
	requestHeader(): RequestHeader | undefined;
	/** The whole durable log, in seq order. */
	snapshotEvents(): readonly EventEnvelope[];
	/**
	 * Only the events this session produced, excluding a fork's inherited prefix.
	 *
	 * Optional because the archive readers and the test fixtures hand this package plain session-like
	 * objects that carry only a durable log; a caller falls back to `snapshotEvents()` there, which is
	 * the conservative answer (the inherited prefix included, never fewer events).
	 */
	ownEvents?(): readonly EventEnvelope[];
	/** The model-visible conversation, with surface replacements applied. */
	deriveMessages(): readonly Message[];
	/** The message one logged event projects to, or `null` when it projects none. */
	deriveEventMessage(event: EventEnvelope): Message | null;
}

/** The agent view: the session it drives and its fallback route. */
export interface Agent {
	readonly session: Session;
	readonly options: { readonly provider?: string; readonly model?: string };
}

// ── Session projections ───────────────────────────────────────────────────────────────────────────

/**
 * The projection keys the cores read. Closed on purpose: the host registry would otherwise accept
 * any key string, so a misspelled or upstream-renamed key would typecheck and then read as an
 * empty value. The adapter translates each key to the host's own (`src/host/dsh/services.ts`).
 */
export type ProjectionKey = "contextBreakdown" | "todos";

/** The `contextBreakdown` projection's envelope half; `messageTokens` is not read. */
export interface ContextBreakdownProjection {
	readonly systemTokens: number;
	readonly toolsTokens: number;
}

/**
 * The projection values a snapshot returns. `contextBreakdown` is read typed; `todos` is the other
 * key a core reads, and only "a value is present" is declared for it — the package that owns the
 * key and its shape (`@deepseek-ai/dsh-tool-todo/types`) is outside this package's pinned type
 * baseline, so the core parses the value defensively instead of naming its shape here.
 */
export interface ProjectionValues {
	readonly contextBreakdown?: ContextBreakdownProjection;
	readonly todos?: unknown;
}

/** The session-projection registry's one read face: the keys a core names, in the contract's vocabulary. */
export interface SessionProjectionRegistry {
	snapshot(session: Session, keys: readonly ProjectionKey[]): { readonly values: ProjectionValues };
}

// ── Registration façade ───────────────────────────────────────────────────────────────────────────
//
// What a core needs from the plugin runtime besides the objects above: subscribe to lifecycle events,
// register a human command, contribute dynamic prompt context, release state on dispose, log, and
// look up a service by name for the getters in the adapter. A second harness implements exactly this
// interface; nothing here names a framework type.

/** An agent's run status; `idle` means nothing is scheduled or running. */
export type AgentStatus = "idle" | "running";

/**
 * The lifecycle events the cores subscribe to, with the payload each listener receives. The names
 * are the host-neutral vocabulary; an adapter maps them onto its own event bus.
 */
export interface HostEvents {
	/** A new agent finished setup. The listener returns `undefined`; asynchronous work is fire-and-forget. */
	"agent/created"(payload: { readonly agent: Agent }): undefined;
	/** The agent's status changed to `status`. */
	"agent/status"(payload: { readonly agent: Agent; readonly status: AgentStatus }): void;
	/** The agent left the registry. */
	"agent/disposed"(payload: { readonly agent: Agent }): void;
	/** One event was appended to the session's durable log. */
	"session/event"(session: Session, event: EventEnvelope): void;
	/** The host is about to rely on the session being durable; pending writes should settle. */
	"session/flush"(session: Session): Promise<void> | void;
	/** The session was released by the host. */
	"session/disposed"(session: Session): void;
}

/** A command's reply: a receipt string, or an error the client shows as a failure. */
export type CommandResult =
	| { readonly kind: "success"; readonly text?: string }
	| { readonly kind: "error"; readonly text: string };

/** One invocation of a registered command. */
export interface CommandInvocation {
	/** The agent whose UI received the command. */
	readonly agent: Agent;
	/** Exact text after the command name. */
	readonly rawInput: string;
	/** Cancellation owned by the dispatching request. */
	readonly signal: AbortSignal;
}

/** A human command (`/name …`) a core registers. */
export interface CommandRegistration {
	/** Lowercase name without the leading slash. */
	readonly name: string;
	readonly description: string;
	/** Free-form input hint shown by capable clients. */
	readonly input?: { readonly hint: string };
	readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}

/** What a prompt-context provider is given at each assembly. */
export interface PromptAssembly {
	/** The agent the prompt is assembled for, when there is one. */
	readonly agent?: Agent;
}

/** One dynamic prompt-context contribution. */
export interface PromptContribution {
	/** Unique name; a duplicate registration is a host error. */
	readonly name: string;
	/** Contributions are joined in ascending order. */
	readonly order: number;
	/** `false` keeps `{{…}}` literal instead of interpolating host prompt variables. */
	readonly interpolate?: boolean;
	/** Static text or a synchronous provider evaluated per assembly; `""` contributes nothing. */
	readonly text: string | ((assembly: PromptAssembly) => string);
}

/** The logging surface a core writes console lines through. */
export interface HostLog {
	info(format: string, ...args: readonly unknown[]): void;
	warn(format: string, ...args: readonly unknown[]): void;
}

/** Named service lookup; `undefined` means this profile does not ship that service. */
export interface ServiceRegistry {
	get(name: string): unknown;
}

/**
 * What a helper needs when it reads nothing but a named service — a projection read, say: the
 * service lookup alone.
 *
 * {@link HostPorts} is the full facility set; this is the one member of it a read-only helper takes,
 * so the helper stays callable from a test fake that never logs, registers or calls a model.
 */
export interface ServiceHost {
	/** Service lookup for the adapter's named getters (`src/host/<harness>/services.ts`). */
	readonly services: ServiceRegistry;
}

/**
 * What a core needs from the host besides registration: where it logs, the named-service lookup the
 * adapter's getters take, and the model port.
 *
 * {@link HostContext} is the full façade a plugin entry hands its core. A helper deeper in a core
 * that only reads these three takes this narrower type, so it stays callable from a test fake that
 * never registers anything; one that reads only {@link ServiceHost.services} takes
 * {@link ServiceHost} instead.
 */
export interface HostPorts {
	/** The plugin's log. */
	readonly log: HostLog;
	/** Service lookup for the adapter's named getters (`src/host/<harness>/services.ts`). */
	readonly services: ServiceRegistry;
	/** The model port. */
	readonly llm: LlmPort;
}

/**
 * The registration façade a plugin core starts with. Every registration is owned by the plugin
 * instance: the adapter releases it when the plugin is disposed, so the core never unregisters.
 */
export interface HostContext extends HostPorts {
	/** Subscribe to one lifecycle event for the plugin's lifetime. */
	on<K extends keyof HostEvents>(name: K, listener: HostEvents[K]): void;
	/** Register one human command for the plugin's lifetime. */
	registerCommand(command: CommandRegistration): void;
	/** Contribute one dynamic prompt-context section for the plugin's lifetime. */
	addPromptContext(contribution: PromptContribution): void;
	/** Run `cleanup` once when the plugin is disposed. */
	onDispose(cleanup: () => void, label?: string): void;
}
