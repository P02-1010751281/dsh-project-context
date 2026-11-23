/** The permission-preset service's reserved "no table entry matches" value; never a switch target. */
export const CUSTOM_PERMISSION_PRESET = "custom";
export function workspaceRegistryOf(ctx) {
    return ctx.get("workspaceRegistry");
}
export function permissionPresetsOf(ctx) {
    return ctx.get("permissionPresets");
}
export function sessionsOf(ctx) {
    return ctx.get("sessions");
}
export function seedAgentsOf(ctx) {
    return ctx.get("agents");
}
export function settingsServiceOf(ctx) {
    return ctx.get("settings");
}
export function tokenMeterOf(ctx) {
    return ctx.get("tokenMeter");
}
export function sessionControllerOf(ctx) {
    return ctx.get("sessionController");
}
export function subagentsOf(ctx) {
    return ctx.get("subagents");
}
export function agentsOf(ctx) {
    return ctx.get("agents");
}
export function sessionTitleOf(ctx) {
    return ctx.get("sessionTitle");
}
export function watchSessionsOf(ctx) {
    return ctx.get("sessions");
}
export function watchConversationOf(ctx) {
    return ctx.get("conversation");
}
/**
 * Contract projection key → host projection key.
 *
 * The map is exhaustive over {@link ProjectionKey} (`satisfies`), so adding a contract key is a
 * compile error here, and the half the host's own map declares is checked against that map: rename
 * `contextBreakdown` upstream and this file stops compiling instead of the read silently returning
 * an empty value — the failure the contract's closed key union exists to prevent.
 * `todos` cannot be part of that check: the key is declared by `@deepseek-ai/dsh-tool-todo/types`,
 * which is outside this package's pinned type baseline, so the map in this program does not
 * contain it and it stays the named string the core also uses.
 */
const HOST_PROJECTION_KEYS = {
    contextBreakdown: "contextBreakdown",
    todos: "todos",
};
/**
 * The session-projection registry, translated to the contract's key vocabulary.
 *
 * The translation is the point of this wrapper: a core names `contextBreakdown`/`todos`, the host
 * receives its own key, and the value table is converted where both shapes are named. A wrapper is
 * allocated per call (two call sites, once per pass or turn), which is the cost of keeping the key
 * vocabulary closed at the core boundary.
 * @param ctx - the service lookup.
 * @returns the contract face, or `undefined` when this profile ships no projection registry.
 */
export function projectionsOf(ctx) {
    const registry = ctx.get("sessionProjections");
    if (registry === undefined)
        return undefined;
    return {
        snapshot(session, keys) {
            const hostKeys = keys.map((key) => HOST_PROJECTION_KEYS[key]);
            // The one identity widening this adapter keeps, and it is documented rather than concealed:
            // every `Session` a core holds is a host `Session` instance (the contract's shape is the read
            // subset of it), but the contract types `id` as a plain string, so the host's branded
            // parameter cannot accept it structurally. Branding every session at every boundary would
            // cost a value-level conversion of an object the cores only ever pass through.
            const snapshot = registry.snapshot(session, hostKeys);
            return { values: snapshot.values };
        },
    };
}
