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
import { type ExportDocument } from "./memory-export.js";
/** What the shim could make of the stored memory. */
export type MemoryExportRead = {
    readonly kind: "document";
    readonly document: ExportDocument;
    readonly mask: (text: string) => string;
}
/** Nothing stored yet: an empty file is not a document to digest. */
 | {
    readonly kind: "missing";
    readonly sourcePath: string;
}
/** A document this schema cannot read section by section — opaque, so exporting would guess. */
 | {
    readonly kind: "unstructured";
    readonly sourcePath: string;
};
/**
 * Read the stored memory as digest sections.
 * @param projectRoot - the project whose memory is read.
 * @param maxMemoryChars - the configured read cap, so the digest sees the same document a pass does.
 * @returns the sections plus the mask to apply, or a named reason there is nothing to export.
 */
export declare function readMemoryExport(projectRoot: string, maxMemoryChars: number): Promise<MemoryExportRead>;
