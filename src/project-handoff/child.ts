/**
 * The continuation session itself: create it in the parent's workspace, carry the model
 * selection and the permission preset the user had switched to, and undo it when the
 * handoff is abandoned. Every step fails open — a child that already exists must not be
 * failed by configuration that could not be carried.
 */

import { type Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import { HandoffDeferred } from "./classify.js";
import { type SessionControllerLike, type WorkspaceRegistryLike } from "./runtime.js";
import { pendingRetire } from "./state.js";

/**
 * Resolve the workspace owning `cwd`, or undefined when no registry/none matches.
 * @param ctx - plugin context carrying the optional workspace registry service.
 * @param cwd - the parent session's cwd, when it has one.
 * @returns the owning workspace id, or undefined when the lookup does not apply.
 */
async function resolveWorkspaceId(ctx: Context, cwd: string | undefined): Promise<string | undefined> {
	if (cwd === undefined) return undefined;
	const registry = ctx.get("workspaceRegistry") as WorkspaceRegistryLike | undefined;
	if (typeof registry?.resolveByPath !== "function") return undefined;
	try {
		const workspace = await registry.resolveByPath(cwd);
		return workspace === undefined ? undefined : String(workspace.id);
	} catch (error: unknown) {
		ctx.logger.warn(
			"dsh-project-context: workspace lookup for %s failed: %s",
			cwd,
			error instanceof Error ? error.message : String(error),
		);
		return undefined;
	}
}

/**
 * Start the handoff child session in the parent's workspace.
 *
 * The web client groups sessions by workspace membership, not by cwd: a child
 * created from `cwd` alone is listed under "未分组" even though its directory is
 * the project root. `session.create` also takes `workspaceId` (mutually exclusive
 * with `cwd`), which derives the cwd from the workspace record and attaches the
 * child to it. Only an exact canonical cwd match counts: the registry resolves by
 * exact path, and guessing an ancestor would silently move the child's cwd.
 * Resolution stays best-effort so profiles without a workspace registry keep the
 * previous cwd-only behavior.
 *
 * The child is an ordinary session in the same workspace: `SessionCreateRequest` is
 * only `{workspaceId?, cwd?, sessionId?, agentPreset?}`, so a handoff cannot chain a
 * parent link, and pi's ever-deepening handoff tree (its 8a2e6e4 flattens a chain
 * that grew one level per handoff in the selector) has no dsh counterpart. The
 * workstream stays reachable through the handoff prompt, `HANDOFF.md` and the index.
 * @param ctx - plugin context carrying the optional workspace registry service.
 * @param controller - the session controller that creates the child.
 * @param cwd - the parent session's cwd, when it has one.
 * @param agentPreset - the parent's agent preset, when dsh composed this session
 *   from one. The preset decides the session's tools and prompt, so dropping it
 *   would resume the work under the deployment default instead.
 * @returns the created child session id.
 */
export async function createChildSession(
	ctx: Context,
	controller: SessionControllerLike,
	cwd: string | undefined,
	agentPreset?: string,
): Promise<string> {
	// `agentPreset` is orthogonal to cwd/workspaceId, so it rides along in both branches.
	const preset = agentPreset === undefined ? {} : { agentPreset };
	const workspaceId = await resolveWorkspaceId(ctx, cwd);
	if (workspaceId !== undefined) {
		const attached = await controller.create({ workspaceId, ...preset });
		return String(attached.sessionId);
	}
	const created = await controller.create(cwd === undefined ? preset : { cwd, ...preset });
	return String(created.sessionId);
}

/** The permission-preset service's reserved "no table entry matches" value; never a switch target. */
const CUSTOM_PERMISSION_PRESET = "custom";

/** Structural view of the permission-preset service (`permissionPresets`); optional per profile. */
interface PermissionPresetsLike {
	/** The session's effective preset name, or {@link CUSTOM_PERMISSION_PRESET}. */
	current(session: unknown): string;
	/** Record the preset and write its sandbox/approval knobs onto the session. */
	set(session: unknown, name: string): void;
}

/** Structural view of the in-memory session store, used to reach the freshly created child. */
interface LiveSessionsLike {
	get(id: string): unknown;
}

/**
 * Carry the parent's permission preset into the continuation. `SessionCreateRequest` has no
 * permission field either, so the child otherwise starts on the deployment/user default: a parent
 * the user had switched to full access hands off to a child that asks for approval again (observed
 * 2026-09-16 — parent `danger-full-access`/`never`, child `workspace-write`/`ask`), which stalls the
 * continuation on its first sensitive tool call.
 *
 * The preset service writes through the child's live Session (`session.append` + the sandbox and
 * approval knob setters), and `session/create` publishes that Session into the in-memory store
 * before it returns, so the child is reachable here. Fail-open in every direction: no service, a
 * child that is not resident, a derived `custom` combination (which the service refuses as a switch
 * target), or a rejected switch must never fail a handoff whose child already exists.
 * @param ctx - plugin context, for the optional services and the warning log.
 * @param childId - the child session to configure.
 * @param session - the parent session being handed off.
 */
export function carryPermissionPreset(ctx: Context, childId: string, session: Session): void {
	const presets = ctx.get("permissionPresets") as PermissionPresetsLike | undefined;
	if (presets === undefined || typeof presets.current !== "function" || typeof presets.set !== "function") return;
	const child = (ctx.get("sessions") as LiveSessionsLike | undefined)?.get?.(childId);
	if (child === undefined || child === null) return;
	try {
		const preset = presets.current(session);
		if (preset === CUSTOM_PERMISSION_PRESET) return;
		presets.set(child, preset);
	} catch (error: unknown) {
		ctx.logger.warn("dsh-project-context: handoff could not carry the permission preset: %s", error instanceof Error ? error.message : String(error));
	}
}

/**
 * The model selection to carry into the continuation: whatever the parent was last routed to, as
 * recorded in its request header. The selection is Session-local (the browser's model picker writes
 * it through `session/selectModel`), and `create` takes no model at all — `SessionCreateRequest` is
 * only cwd/workspaceId/agentPreset — so without this the child would start on the deployment default
 * and silently drop the model and thinking level the user had switched to. Returns `undefined` when
 * the parent has not routed a request yet or the header carries no usable pair.
 * @param session - the parent session being handed off.
 * @returns the provider/model/effort triple, or `undefined`.
 */
export function parentModelSelection(session: Session): { provider: string; model: string; reasoningEffort?: string } | undefined {
	const routed = session.requestHeader()?.config as { provider?: unknown; model?: unknown; reasoningEffort?: unknown } | undefined;
	const provider = routed?.provider;
	const model = routed?.model;
	if (typeof provider !== "string" || provider.length === 0 || typeof model !== "string" || model.length === 0) return undefined;
	// An absent effort must stay absent: the selection API clears any inherited effort when the field
	// is omitted, which is exactly the parent's state.
	const reasoningEffort = typeof routed?.reasoningEffort === "string" && routed.reasoningEffort.length > 0 ? routed.reasoningEffort : undefined;
	return reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort };
}

/**
 * Apply {@link parentModelSelection} to the freshly created child. Fail-open in every direction: a
 * runtime without `selectModel`, a parent that never routed a request, or a rejected selection must
 * never fail a handoff whose child already exists.
 * @param ctx - plugin context, for the warning log.
 * @param controller - the session controller that owns the child.
 * @param childId - the child session to configure.
 * @param session - the parent session being handed off.
 */
export async function carryModelSelection(
	ctx: Context,
	controller: SessionControllerLike,
	childId: string,
	session: Session,
): Promise<void> {
	if (controller.selectModel === undefined) return;
	const selection = parentModelSelection(session);
	if (selection === undefined) return;
	try {
		await controller.selectModel({ sessionId: childId, ...selection });
	} catch (error: unknown) {
		ctx.logger.warn("dsh-project-context: handoff could not carry the parent's model selection: %s", error instanceof Error ? error.message : String(error));
	}
}

/**
 * Undo a child whose handoff was abandoned. The child is already published and dsh has no delete
 * RPC, so the visible facts are reversed instead: a possibly admitted seed is cancelled, the switch
 * marker is replaced by a plain title, and a deferral's session is archived so it does not sit in
 * the workspace list. Every step is best effort, but the *decision to hide* a child is not: a child
 * whose seed could not be cancelled keeps running a duplicate continuation, so it stays visible
 * instead of being quietly archived. Cancelling an unseeded child is a no-op, so it is always tried.
 * @param ctx - plugin context, for the optional registry and the warning log.
 * @param controller - the session controller that owns the child.
 * @param childId - the abandoned child.
 * @param parentLabel - the parent's short label, for the title.
 * @param error - the failure that abandoned the handoff.
 * @param promptAttempted - whether the seed prompt was already sent (it can be admitted before the
 *   call rejects, so a rejection is not proof that the child is idle).
 */
export async function abandonChild(
	ctx: Context,
	controller: SessionControllerLike,
	childId: string,
	parentLabel: string,
	error: unknown,
	promptAttempted: boolean,
): Promise<void> {
	const deferred = error instanceof HandoffDeferred;
	// Nothing was sent, so nothing can be running; otherwise the cancel below must prove it.
	let cancelled = !promptAttempted;
	if (promptAttempted && controller.cancel) {
		try {
			await controller.cancel({ sessionId: childId });
			cancelled = true;
		} catch (cancelError: unknown) {
			ctx.logger.warn("dsh-project-context: handoff could not cancel the abandoned child: %s", cancelError instanceof Error ? cancelError.message : String(cancelError));
		}
	}
	if (controller.rename) {
		try {
			await controller.rename({ sessionId: childId, title: deferred ? `handoff deferred · ${parentLabel}` : `handoff failed · ${parentLabel}` });
		} catch {
			// The child stays unmarked only in the list; nothing else to do.
		}
	}
	// Only a deferral is unambiguous garbage: nobody asked for it and the parent is still working.
	// A genuine failure, and a child that may still be running, stay visible so the user can see it.
	// Archiving only hides (it does not delete), and the client can undo it via unarchiveSession.
	if (!deferred || !cancelled) return;
	const registry = ctx.get("workspaceRegistry") as WorkspaceRegistryLike | undefined;
	if (registry?.archiveSession === undefined) return;
	try {
		await registry.archiveSession(childId);
	} catch (archiveError: unknown) {
		ctx.logger.warn("dsh-project-context: handoff could not archive the abandoned child: %s", archiveError instanceof Error ? archiveError.message : String(archiveError));
	}
}

/**
 * Retire the session a handoff replaced: stop whatever still runs for it, then archive it.
 *
 * dsh's handoff *forks* — the child is a separate session — so the session that was handed off stays
 * live, and because the workspace list groups by activity the still-running old session sits above its
 * own continuation. The host has no "end session" RPC; its archive is the closest thing, and
 * `stopActivity` is what makes it apply to a session with running work (without it the host *refuses*
 * rather than stopping anything). The archive only hides: the log, the archive artifacts and the
 * workspace position all survive, and the client can undo it.
 *
 * Failures are logged, never thrown: the handoff itself already succeeded.
 * @param ctx - plugin context carrying the optional workspace registry service.
 * @param session - the session that was handed off.
 */
export async function retireSession(ctx: Context, session: Session): Promise<void> {
	const registry = ctx.get("workspaceRegistry") as WorkspaceRegistryLike | undefined;
	if (registry?.archiveSession === undefined) return;
	try {
		await registry.archiveSession(String(session.id), { stopActivity: true });
		ctx.logger.info("dsh-project-context: retired the handed-off session %s (archived; unarchive it in the client to bring it back)", String(session.id));
	} catch (error: unknown) {
		ctx.logger.warn("dsh-project-context: could not retire the handed-off session %s: %s", String(session.id), error instanceof Error ? error.message : String(error));
	}
}

/**
 * Retire the handed-off session now, or — when its own turn is still open — when that turn ends.
 * @param ctx - plugin context.
 * @param session - the session that was handed off.
 * @param turnOpen - whether the handoff ran inside that session's own open turn (the manual path).
 */
export function scheduleRetirement(ctx: Context, session: Session, turnOpen: boolean): void {
	if (!turnOpen) {
		void retireSession(ctx, session);
		return;
	}
	pendingRetire.add(String(session.id));
}

/** Consume a scheduled retirement; called on every `turn/end` so a deferred one is not forgotten. */
export function retireIfPending(ctx: Context, session: Session): void {
	if (!pendingRetire.delete(String(session.id))) return;
	void retireSession(ctx, session);
}
