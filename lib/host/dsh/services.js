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
export function projectionsOf(ctx) {
    return ctx.get("sessionProjections");
}
