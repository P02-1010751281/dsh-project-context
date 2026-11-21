/**
 * The session-log state machine, I/O half: the two sides of the archive and nothing else.
 *
 * The split mirrors `staleness.ts` / `staleness-source.ts` in the memory core: `session-state.ts` owns
 * the rules and never opens anything, this module knows that a session is a directory under
 * `.agents/memory/session-logs/` with a `meta.json` and a row in `INDEX.md`.
 *
 * Read-only by construction. Every state a session can be in is derived here on each read, so a report
 * can never disagree with the disk it was built from — which is the whole reason the four AOCI failure
 * names (Missing / Orphan / Stale / Unbaselined) become checkable only now that something reads both
 * sides together.
 */
import { type SessionStateReport } from "./session-state.js";
/**
 * Judge the whole archive against its own index.
 *
 * The index side is read from the file rather than from a projection so a wrong row is visible: reading
 * the regenerated view would compare the directory with itself and find nothing.
 * @param projectRoot - the project whose `.agents/memory/session-logs` is read.
 * @param now - the clock the live/settled split is measured against; injected for tests.
 * @returns the verdict for every session either side knows about.
 */
export declare function measureSessionStates(projectRoot: string, now?: number): Promise<SessionStateReport>;
