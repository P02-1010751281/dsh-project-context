/**
 * The dsh **shim** for compaction events: the durable host records → the core's normalized DTOs.
 *
 * This is the only file that knows what dsh writes. `compaction.ts` folds DTOs and stays host-free, so
 * this shim is where a host change lands — and, when the events change shape, the one place that has to.
 *
 * It exists because this package does **not** depend on `@deepseek-ai/dsh-compaction`: that package's
 * types are a module augmentation of `SessionEventMap`, and importing it to name four payloads would
 * pull the compaction service into a plugin whose whole boundary is not touching that service. So the
 * four shapes are read structurally, the way `project-context/session-index.ts` reads `session/title`.
 * Registered as `SH-10` in `docs/harness/integration.md` with its removal condition: add that package
 * as a type-only devDependency at our pinned line, then delete this file's shape knowledge.
 *
 * The refusal rules are the contract with the core: an event type under the `compaction/` prefix that
 * we do not know makes the whole feed `malformed` rather than silently skipped, because a future host
 * that adds one would otherwise make every count quietly understate. A record whose payload we cannot
 * trust (no transaction id, no payload object) is equally `malformed`; a merely *absent* optional field
 * (shadow price, provider, model, error) only drops that field.
 */
import {} from "./compaction.js";
/**
 * Every `compaction/*` type the dsh line emits today, from
 * `packages/compaction/compaction/src/types.ts` (`CompactionId`, `shadowedRange`, `shadowedSeqs`,
 * `shadowedTokenCount`, `provider`, `model`, optional `error`).
 */
const KNOWN_COMPACTION_EVENTS = new Set(["compaction/start", "compaction/summary", "compaction/end", "compaction/prune"]);
function asRecord(value) {
    return typeof value === "object" && value !== null ? value : undefined;
}
/** A token count the log may state; anything else is a missing field, never a `0`. */
function statedTokens(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function statedText(value) {
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
/**
 * Read one session's durable events into the core's feed.
 *
 * @param events - whatever `session.snapshotEvents()` returned. Typed `unknown` on purpose: the event
 * map this host uses is not ours to declare, and a non-array must read as `unreadable`, not throw.
 */
export function readCompactionFeed(events) {
    if (!Array.isArray(events))
        return { kind: "unavailable", reason: "unreadable" };
    const records = [];
    for (const raw of events) {
        const event = asRecord(raw);
        const type = event?.type;
        if (typeof type !== "string" || !type.startsWith("compaction/"))
            continue;
        if (!KNOWN_COMPACTION_EVENTS.has(type))
            return { kind: "unavailable", reason: "malformed" };
        const data = asRecord(event?.data);
        if (data === undefined)
            return { kind: "unavailable", reason: "malformed" };
        if (type === "compaction/start") {
            records.push({ kind: "start" });
            continue;
        }
        if (type === "compaction/prune") {
            const tokens = statedTokens(data.shadowedTokenCount);
            records.push({ kind: "prune", ...(tokens === undefined ? {} : { shadowedTokens: tokens }) });
            continue;
        }
        // Both remaining types must name the transaction: without an id a replayed record cannot be
        // told from a second one, so any count built from one would be a guess.
        const id = statedText(data.compactionId);
        if (id === undefined)
            return { kind: "unavailable", reason: "malformed" };
        if (type === "compaction/summary") {
            const tokens = statedTokens(data.shadowedTokenCount);
            const provider = statedText(data.provider);
            const model = statedText(data.model);
            records.push({
                kind: "summary",
                id,
                ...(tokens === undefined ? {} : { shadowedTokens: tokens }),
                ...(provider === undefined ? {} : { provider }),
                ...(model === undefined ? {} : { model }),
            });
            continue;
        }
        const error = typeof data.error === "string" && data.error.trim() !== "" ? data.error : undefined;
        records.push({ kind: "end", id, ...(error === undefined ? {} : { error }) });
    }
    return { kind: "records", records };
}
