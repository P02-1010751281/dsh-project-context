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

import path from "node:path";
import { ensureMemoryGitignore, memoryDir, readOptional, writeAtomic } from "./project-state.js";

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

const EMPTY_STATE: LearnState = { autolearnAt: 0, lastAttemptAt: 0 };

export function learnStateFile(projectRoot: string): string {
	return path.join(memoryDir(projectRoot), "autolearn-state.json");
}

/** Accept only a usable epoch-ms timestamp; anything else means "not recorded". */
function timestamp(value: unknown): number | undefined {
	// The exact value is kept: the material gate is compared against a file mtime, which carries a
	// sub-millisecond fraction, and rounding it here would make every stamp look newer than the
	// gate and re-open the pass on every idle.
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeState(raw: unknown): LearnState {
	const source = raw !== null && typeof raw === "object" && !Array.isArray(raw)
		? (raw as { autolearnAt?: unknown; lastAttemptAt?: unknown })
		: {};
	return {
		autolearnAt: timestamp(source.autolearnAt) ?? 0,
		lastAttemptAt: timestamp(source.lastAttemptAt) ?? 0,
	};
}

/**
 * Read the gate.
 *
 * A missing, unreadable, or corrupt file reads as "never ran" instead of
 * throwing: the gate is an optimization, and a damaged state file must never
 * block — let alone fail — a pass that could still learn something.
 * @param projectRoot - resolved project root that owns the state file.
 * @returns the stored state, or the empty state when there is nothing usable.
 */
export async function readLearnState(projectRoot: string): Promise<LearnState> {
	const raw = await readOptional(learnStateFile(projectRoot));
	if (!raw.trim()) return { ...EMPTY_STATE };
	try {
		return normalizeState(JSON.parse(raw));
	} catch {
		return { ...EMPTY_STATE };
	}
}

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
export async function updateLearnState(projectRoot: string, patch: Partial<LearnState>): Promise<LearnState> {
	const current = await readLearnState(projectRoot);
	const next: LearnState = {
		autolearnAt: timestamp(patch.autolearnAt) ?? current.autolearnAt,
		lastAttemptAt: timestamp(patch.lastAttemptAt) ?? current.lastAttemptAt,
	};
	try {
		// The state file is a local artifact; make sure it is ignored even when autolearn runs
		// before any memory write established the ignore file.
		await ensureMemoryGitignore(memoryDir(projectRoot));
		await writeAtomic(learnStateFile(projectRoot), `${JSON.stringify(next)}\n`);
	} catch {
		// Best effort: see the contract above.
	}
	return next;
}
