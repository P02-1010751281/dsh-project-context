/**
 * The **shim** behind `/context export`: the stored memory document → the core's
 * {@link ExportDocument}.
 *
 * It reads the memory through `loadMemory`, the same reader the consolidation pass and the injection
 * use, so the digest is the effective memory (journal folded, a newer render adopted) rather than
 * whatever bytes happen to sit in `MEMORY.md` at that instant. The sections come from
 * `sectionsFromMarkdown`, the one structural reader of the four-section schema; this file never
 * re-parses headings or bullets, so a digest cannot disagree with a pass about what an entry is.
 *
 * Two decisions live here rather than in the core, because they are about the source document:
 *  - **Index is not exported.** The digest is for a foreign tool reading `AGENTS.md`; Index is
 *    pointers into *this* repository, and shipping it would lend a stale path the authority of the
 *    digest. The heading name is the schema's own (`MEMORY_SECTIONS`), not a copy.
 *  - **the mask is the package's redactor.** Entries ride to another tool, so credential-shaped text
 *    is masked at the boundary; the core takes the function, so the patterns exist once.
 *
 * Removal condition: none of its own — it mirrors `.agents/memory/MEMORY.md` and the schema table,
 * both of which this repository owns.
 */
import path from "node:path";
import { MEMORY_SECTIONS } from "../project-memory/memory-schema.js";
import { loadMemory } from "../project-memory/load.js";
import { sectionsFromMarkdown } from "../project-memory/sections.js";
import { memoryFile, redactSecrets } from "../shared/project-state.js";
import {} from "./memory-export.js";
/** The section the digest deliberately leaves out; see the module comment. */
const EXCLUDED_SECTION = "Index";
/** The project-relative path a receipt names for the memory document. */
function documentPath(projectRoot) {
    return path.relative(projectRoot, memoryFile(projectRoot)).split(path.sep).join("/");
}
/**
 * Read the stored memory as digest sections.
 * @param projectRoot - the project whose memory is read.
 * @param maxMemoryChars - the configured read cap, so the digest sees the same document a pass does.
 * @returns the sections plus the mask to apply, or a named reason there is nothing to export.
 */
export async function readMemoryExport(projectRoot, maxMemoryChars) {
    const sourcePath = documentPath(projectRoot);
    const memory = await loadMemory(projectRoot, maxMemoryChars);
    if (memory.unreadable)
        return { kind: "unstructured", sourcePath };
    if (memory.text.trim() === "")
        return { kind: "missing", sourcePath };
    const sections = sectionsFromMarkdown(memory.text);
    // An opaque document is preserved verbatim by the store, so there are no entries to digest — and
    // guessing at them (splitting on `- `) would ship prose the schema never accepted.
    if (sections === undefined)
        return { kind: "unstructured", sourcePath };
    return {
        kind: "document",
        mask: redactSecrets,
        document: {
            sourcePath,
            sections: MEMORY_SECTIONS
                .filter((spec) => spec.heading !== EXCLUDED_SECTION)
                .map((spec) => ({ heading: spec.heading, entries: sections[spec.heading.toLowerCase()] })),
        },
    };
}
