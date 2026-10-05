/**
 * Project-local autolearn gate state.
 *
 * The autolearn throttle needs two facts to outlive the process: which material was already
 * distilled, and when the last pass ran. Kept in memory, every restart forgets them and runs a pass
 * again on material that was already distilled. Kept in the project (rather than in dsh settings),
 * every session of this machine shares them; the file is a local artifact and is listed in the
 * memory `.gitignore`, like the journal and the backups next to it.
 *
 * Storage: `<project>/.agents/memory/autolearn-state.json`
 */
export interface LearnState {
    /**
     * The material timestamp the last recorded pass distilled, in epoch ms (a file mtime, so not
     * necessarily an integer); 0 when no pass was ever recorded.
     */
    autolearnAt: number;
    /**
     * When the last recorded pass ran, in epoch ms; 0 when none was. Separate from
     * {@link autolearnAt} because the interval gate measures distance from the *attempt*, while the
     * material gate must keep comparing against what was actually distilled.
     */
    lastAttemptAt: number;
}
export declare function learnStateFile(projectRoot: string): string;
/**
 * Read the gate.
 *
 * A missing, unreadable, or corrupt file reads as "never ran" instead of
 * throwing: the gate is an optimization, and a damaged state file must never
 * block — let alone fail — a pass that could still learn something.
 * @param projectRoot - resolved project root that owns the state file.
 * @returns the stored state, or the empty state when there is nothing usable.
 */
export declare function readLearnState(projectRoot: string): Promise<LearnState>;
/**
 * Read-modify-write one patch of the state file, published atomically.
 *
 * A failed write is swallowed and the intended state is still returned: losing
 * the gate only costs one extra pass, while throwing here would lose the pass
 * that just ran.
 * @param projectRoot - resolved project root that owns the state file.
 * @param patch - fields to merge over the current state.
 * @returns the state that was written (or would have been).
 */
export declare function updateLearnState(projectRoot: string, patch: Partial<LearnState>): Promise<LearnState>;
