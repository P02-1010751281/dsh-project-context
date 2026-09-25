/**
 * Structural views of the optional host services this plugin consumes, and the routed model
 * of a session. Each service is optional per profile, so every view is read defensively.
 */

import { type Session } from "@deepseek-ai/dsh-session";
import { type PluginConfig } from "../shared/config.js";

/** Structural view of the web/API session runtime; the service is optional per profile. */
export interface SessionControllerLike {
	create(request: { cwd?: string; workspaceId?: string; agentPreset?: string }): Promise<{ sessionId: string }>;
	rename?(request: { sessionId: string; title: string }): Promise<unknown>;
	/** Session-local model selection; absent in runtimes that predate it. */
	selectModel?(request: { sessionId: string; provider: string; model: string; reasoningEffort?: string }): Promise<unknown>;
	/** Cancels the child's admitted turn when a seed has to be undone; absent in older runtimes. */
	cancel?(request: { sessionId: string }): Promise<unknown>;
	prompt(
		request: {
			requestId: string;
			sessionId: string;
			mode: "queue" | "steer";
			content: readonly { type: "text"; text: string }[];
		},
		signal: AbortSignal,
	): Promise<unknown>;
}

/**
 * Structural view of the workspace registry (`ctx.workspaceRegistry`); the service
 * is optional per profile, and `resolveByPath` canonicalizes like the registry does.
 */
export interface WorkspaceRegistryLike {
	resolveByPath(path: string): Promise<{ readonly id: string } | undefined>;
	/**
	 * Hides a session from every grouping surface without touching its log or its workspace
	 * accounting. Used to make an abandoned handoff child invisible instead of leaving an empty
	 * session in the sidebar (there is no delete RPC; the archive is undoable through the client's
	 * `uiWorkspace.unarchiveSession`, which restores the recorded workspace position).
	 */
	archiveSession?(sessionId: string): Promise<void>;
}

/** Structural view of the token meter; the service is optional per profile. */
export interface TokenMeterLike {
	measure(session: Session): { totalTokens: number; surfaceTokens: number };
}

/** Structural view of the settings service; writes persist the user layer. */
export interface SettingsLike {
	update(ns: string, patch: object): Promise<void>;
}

/** Resolve the handoff route: explicit config, then the session's latest routed request. */
export function resolveTarget(session: Session, config: PluginConfig): { provider: string; model: string } | undefined {
	if (config.provider && config.model) return { provider: config.provider, model: config.model };
	const routed = session.requestHeader()?.config;
	if (routed && routed.provider && routed.model) return { provider: routed.provider, model: routed.model };
	return undefined;
}
