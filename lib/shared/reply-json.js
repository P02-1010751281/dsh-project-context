/**
 * Reading the structured reply out of a model response: a tolerant JSON object scan (models
 * wrap JSON in prose or fences), the string-field reader, and the consolidation parser whose
 * per-field verdicts the caller reports.
 */
export function parseJsonObject(text) {
    const candidate = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    try {
        return JSON.parse(candidate);
    }
    catch {
        // Fall through to a braced-object scan for models that add prose around the JSON.
    }
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start)
        return undefined;
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    }
    catch {
        return undefined;
    }
}
/**
 * Read one `"key": "value"` string out of a reply whose object does not parse. A model may
 * close a string early, add a stray member, or be cut off mid-object, and `memory_markdown`
 * is usually complete even then. Undefined for a missing or unterminated value.
 */
function jsonStringField(text, key) {
    const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
    if (!match)
        return undefined;
    let index = match.index + match[0].length;
    let out = "";
    while (index < text.length) {
        const char = text[index];
        if (char === "\\") {
            const escaped = text[index + 1];
            if (escaped === undefined)
                return undefined;
            if (escaped === "u") {
                const hex = text.slice(index + 2, index + 6);
                if (!/^[0-9a-f]{4}$/i.test(hex))
                    return undefined;
                out += String.fromCharCode(Number.parseInt(hex, 16));
                index += 6;
                continue;
            }
            out += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped === "r" ? "\r" : escaped;
            index += 2;
            continue;
        }
        if (char === '"')
            return out.trim();
        out += char;
        index += 1;
    }
    return undefined;
}
/** A reply that meant to be the requested JSON object; it must never be stored as memory. */
function looksLikeJsonReply(text) {
    const candidate = text.replace(/^```(?:json)?\s*/i, "").trim();
    return candidate.startsWith("{") || /"memory_markdown"\s*:/.test(candidate);
}
/**
 * Read an optional list of strings out of a context field. `undefined` means the key was absent
 * (nothing to say), a string[] means it was usable, and `null` means it was present but
 * malformed — a caller must refuse the whole context rather than treat that as an empty list,
 * since doing the latter overwrites a good CONTEXT.md with hollowed-out sections.
 */
export function readContextList(value) {
    if (value === undefined || value === null)
        return value === null ? null : undefined;
    if (!Array.isArray(value))
        return null;
    if (!value.every((item) => typeof item === "string"))
        return null;
    return value.length > 0 ? value : undefined;
}
/** Undefined means the pass must fail without touching MEMORY.md. */
export function parseConsolidation(text) {
    const parsed = parseJsonObject(text);
    if (parsed && typeof parsed.memory_markdown === "string") {
        const raw = parsed.context;
        // A `context` key that is absent or null is the model saying nothing: not an error. Any
        // other non-object, or an object that cannot yield a complete update, is unusable and is
        // reported rather than silently dropped.
        const context = parseContextMember(raw);
        const contextUnusable = context === undefined && raw !== undefined && raw !== null;
        return {
            memory: parsed.memory_markdown,
            ...(context === undefined ? {} : { context }),
            ...(contextUnusable ? { contextUnusable: true } : {}),
        };
    }
    // A reply that failed to parse can still carry the memory field intact.
    const recovered = jsonStringField(text, "memory_markdown");
    if (recovered)
        return { memory: recovered };
    // Older or less capable models may still return Markdown directly.
    if (!looksLikeJsonReply(text))
        return { memory: text };
    return undefined;
}
/**
 * Validate one `context` member, whether it came from the JSON reply or from a tool call's
 * arguments. `undefined` means the member could not be used — absent, null, a non-object, or an
 * object that cannot yield a complete update.
 *
 * The caller has to tell "absent" from "unusable" apart to decide whether to log a notice, and it
 * does that by looking at the raw value: this function deliberately collapses both to `undefined`
 * so the shape rule lives in exactly one place.
 */
export function parseContextMember(value) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "object")
        return undefined;
    const context = value;
    const keyPoints = readContextList(context.key_points);
    const openTasks = readContextList(context.open_tasks);
    if (typeof context.summary !== "string" || keyPoints === null || openTasks === null)
        return undefined;
    return {
        title: typeof context.title === "string" ? context.title : "Untitled session",
        summary: context.summary,
        key_points: keyPoints ?? [],
        open_tasks: openTasks ?? [],
    };
}
/**
 * Decode the raw JSON argument text a tool call carried.
 *
 * dsh's adapter streams a tool call's arguments as text (`tool-call-delta` fragments, joined
 * authoritatively by `block-end`), where the pi sibling's plumbing hands back an already-parsed
 * object; so the decode happens here, through the same tolerant reader the text path uses. An
 * undefined result means the text was not a JSON object at all, which the caller treats as an
 * unusable call rather than an empty one.
 */
export function parseToolArguments(text) {
    const parsed = parseJsonObject(text);
    return parsed === undefined || Array.isArray(parsed) ? undefined : parsed;
}
