/**
 * The host service views.
 *
 * Every service lookup in the repository lives here. The cores ask for a named view and never for a
 * service name, so a second host implements these getters against its own registry and the plugin
 * logic stays unchanged. Each view is a structural subset: undefined means "this profile does not
 * ship that service", which is a state the callers already handle deliberately.
 *
 * The getters accept {@link ServiceRegistry} rather than a full `Context` so the handoff watcher —
 * which is deliberately testable with a fake `{ get }` — uses the same seam.
 */
import type { Session, SessionProjectionRegistry, UserMessage } from "../contract.js";

/** The one thing a service lookup needs from the plugin context. */
export interface ServiceRegistry {
	get(name: string): unknown;
}

/** The permission-preset service's reserved "no table entry matches" value; never a switch target. */
export const CUSTOM_PERMISSION_PRESET = "custom";

/** Structural view of the permission-preset service (`permissionPresets`); optional per profile. */
export interface PermissionPresetsLike {
	/** The session's effective preset name, or {@link CUSTOM_PERMISSION_PRESET}. */
	current(session: unknown): string;
	/** Record the preset and write its sandbox/approval knobs onto the session. */
	set(session: unknown, name: string): void;
}

/** Structural view of the in-memory session store, used to reach the freshly created child. */
export interface LiveSessionsLike {
	get(id: string): unknown;
}

/** The one live-Agent capability the seed needs: queueing an ordinary follow-up turn. */
export interface SeedTargetLike {
	followup(message: UserMessage): void;
}

/** Structural view of the optional `subagents` host service: this session's direct children. */
export interface SubagentsLike {
	/**
	 * Direct-child read from the parent-owned `subagent/catalog` projection. Every row carries `id`
	 * and `mode` (dsh 0.1.6's classified `{kind, id, mode, activity, hasChildren}` row and
	 * 0.1.7-alpha.1's bare `{id, createdAt, mode, label}` catalog row both do), so one read covers
	 * both versions; a `kind: "diagnostic"` row means the host could not classify that child at all.
	 */
	listChildren?(parentSessionId: string, signal?: AbortSignal): Promise<readonly unknown[]>;
}

/** Structural view of the host's live Agent registry, the only place turn activity is readable. */
export interface AgentsLike {
	get(sessionId: string): { readonly status?: unknown } | undefined;
}

/** Structural view of the web/API session runtime; the service is optional per profile. */
export interface SessionControllerLike {
	create(request: { cwd?: string; workspaceId?: string; agentPreset?: string }): Promise<{ sessionId: string }>;
	rename?(request: { sessionId: string; title: string }): Promise<unknown>;
	/** Session-local model selection; absent in runtimes that predate it. */
	selectModel?(request: { sessionId: string; provider: string; model: string; reasoningEffort?: string }): Promise<unknown>;
	/** Cancels the child's admitted turn when a seed has to be undone; absent in older runtimes. */
	cancel?(request: { sessionId: string }): Promise<unknown>;
}

/**
 * Structural view of the workspace registry; the service is optional per profile, and
 * `resolveByPath` canonicalizes like the registry does.
 */
export interface WorkspaceRegistryLike {
	resolveByPath(path: string): Promise<{ readonly id: string } | undefined>;
	/**
	 * Hides a session from every grouping surface without touching its log or its workspace
	 * accounting. Used to make an abandoned handoff child invisible instead of leaving an empty
	 * session in the sidebar (there is no delete RPC; the archive is undoable through the client's
	 * `uiWorkspace.unarchiveSession`, which restores the recorded workspace position).
	 *
	 * `stopActivity` asks the host to **stop** whatever still runs for the session instead of
	 * refusing the archive because of it: without it a session with running work is rejected with
	 * `WorkspaceActiveSessionError`, with it the archive is written and the stops are requested
	 * afterwards. A handed-off session is retired with it (the host has no "end session" RPC); an
	 * abandoned child is archived without it, so a child that may still be running is left alone.
	 */
	archiveSession?(sessionId: string, options?: { readonly stopActivity?: boolean }): Promise<void>;
}

/** Structural view of the token meter; the service is optional per profile. */
export interface TokenMeterLike {
	/**
	 * `totalTokens` is anchored on the provider's reported usage; `surfaceTokens` is priced by the
	 * meter's fixed-density heuristic, so the two are on different bases and must not be subtracted.
	 * `overheadTokens` is the envelope from the harness's `contextBreakdown` projection; it is never
	 * derived from the two above.
	 */
	measure(session: Session): { totalTokens: number; surfaceTokens: number; overheadTokens?: number };
}

/** Structural view of the settings service; writes persist the user layer. */
export interface SettingsLike {
	update(ns: string, patch: object): Promise<void>;
}

/**
 * Structural view of the title service. Optional per profile, so both reads are defended: `get`
 * folds the session's own log for the latest `session/title`, and `rename` appends one with the
 * `user` source and reports the accepted snapshot. Both are synchronous, and `rename` throws when
 * the session is not live in this store.
 */
export interface SessionTitleLike {
	get?(session: Session): { readonly title?: unknown } | undefined;
	rename?(session: Session, title: string): { readonly title?: unknown } | undefined;
}

/** A client-side projection face: a synchronous snapshot plus an optional subscription. */
export interface SnapshotFace {
	getSnapshot(): unknown;
	subscribe?(listener: () => void): () => void;
}

/** The session-list slice the handoff watcher reads. */
export interface WatchSessionsLike {
	readonly list: {
		getSnapshot(): {
			readonly ids: readonly unknown[];
			readonly byId: Readonly<Record<string, { readonly cwd?: unknown; readonly origin?: unknown } | undefined>>;
			readonly current?: unknown;
			/** Arrival lifecycle: `pending` means no pull has landed yet. */
			readonly phase?: unknown;
		};
		subscribe(listener: () => void): () => void;
	};
	binding(id: unknown): { readonly session: { readonly projections: { faceOf(key: string): SnapshotFace } } } | undefined;
	open(id: unknown): void;
}

/** The composer slice the handoff watcher reads before switching sessions. */
export interface WatchConversationLike {
	readonly input: { shell(id: unknown): { readonly state: SnapshotFace } };
}

export function workspaceRegistryOf(ctx: ServiceRegistry): WorkspaceRegistryLike | undefined {
	return ctx.get("workspaceRegistry") as WorkspaceRegistryLike | undefined;
}

export function permissionPresetsOf(ctx: ServiceRegistry): PermissionPresetsLike | undefined {
	return ctx.get("permissionPresets") as PermissionPresetsLike | undefined;
}

export function sessionsOf(ctx: ServiceRegistry): LiveSessionsLike | undefined {
	return ctx.get("sessions") as LiveSessionsLike | undefined;
}

export function seedAgentsOf(ctx: ServiceRegistry): { get?(id: string): SeedTargetLike | undefined } | undefined {
	return ctx.get("agents") as { get?(id: string): SeedTargetLike | undefined } | undefined;
}

export function settingsServiceOf(ctx: ServiceRegistry): SettingsLike | undefined {
	return ctx.get("settings") as SettingsLike | undefined;
}

export function tokenMeterOf(ctx: ServiceRegistry): TokenMeterLike | undefined {
	return ctx.get("tokenMeter") as TokenMeterLike | undefined;
}

export function sessionControllerOf(ctx: ServiceRegistry): SessionControllerLike | undefined {
	return ctx.get("sessionController") as SessionControllerLike | undefined;
}

export function subagentsOf(ctx: ServiceRegistry): SubagentsLike | undefined {
	return ctx.get("subagents") as SubagentsLike | undefined;
}

export function agentsOf(ctx: ServiceRegistry): AgentsLike | undefined {
	return ctx.get("agents") as AgentsLike | undefined;
}

export function sessionTitleOf(ctx: ServiceRegistry): SessionTitleLike | undefined {
	return ctx.get("sessionTitle") as SessionTitleLike | undefined;
}

export function watchSessionsOf(ctx: ServiceRegistry): WatchSessionsLike | undefined {
	return ctx.get("sessions") as WatchSessionsLike | undefined;
}

export function watchConversationOf(ctx: ServiceRegistry): WatchConversationLike | undefined {
	return ctx.get("conversation") as WatchConversationLike | undefined;
}

export function projectionsOf(ctx: ServiceRegistry): SessionProjectionRegistry | undefined {
	return ctx.get("sessionProjections") as SessionProjectionRegistry | undefined;
}
