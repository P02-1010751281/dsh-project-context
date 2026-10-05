/**
 * One-time migration of the legacy layouts (`.pi/`, `.agents/memory/skills`, `~/.omp`)
 * into the current `.agents` tree.
 */
export type MigrationResult = {
    moved: string[];
    importedSkills: number;
    /** Destination paths whose legacy counterpart was newer and was discarded, not merged. */
    superseded: string[];
    /** Destination paths whose legacy counterpart could not be merged and was left in place. */
    conflicts: string[];
};
/** Consolidate legacy memory, context, logs and skills into the `.agents/` layout. */
export declare function migrateProjectState(projectRoot: string): Promise<MigrationResult>;
