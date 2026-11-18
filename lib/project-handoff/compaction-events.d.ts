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
import { type CompactionFeed } from "./compaction.js";
/**
 * Read one session's durable events into the core's feed.
 *
 * @param events - whatever `session.snapshotEvents()` returned. Typed `unknown` on purpose: the event
 * map this host uses is not ours to declare, and a non-array must read as `unreadable`, not throw.
 */
export declare function readCompactionFeed(events: unknown): CompactionFeed;
