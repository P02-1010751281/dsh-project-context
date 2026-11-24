/**
 * The four Loader entry ids that own a settings card.
 *
 * Kept in one module with no imports so both halves can read the same strings: the host side writes
 * `/handoff` settings patches to `HANDOFF_SETTINGS_NAMESPACE`, and the client side keys its cards the
 * same way. Two copies of these literals would drift silently — a mistyped namespace does not throw,
 * it writes to nobody and the save looks applied.
 */
export declare const CONTEXT_SETTINGS_NAMESPACE: "project-context";
export declare const MEMORY_SETTINGS_NAMESPACE: "project-memory";
export declare const AUTOLEARN_SETTINGS_NAMESPACE: "project-autolearn";
export declare const HANDOFF_SETTINGS_NAMESPACE: "project-handoff";
