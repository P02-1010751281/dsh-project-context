/**
 * Progressive disclosure for the two documents injected into every turn's system prompt.
 *
 * The kept sections are the ones where a wrong answer is a violation or the repeat of a fixed bug;
 * each of the rest costs one line naming the file instead of its whole body, and the block ends with
 * a read-first sentence. The split is by heading, never by meaning: the headings are the ones the
 * render schemas own, so a section is either rendered whole or replaced by its own line and can
 * never take another's slot. A heading the spec does not name stays inline, and a document with no
 * usable heading is injected whole — a schema change degrades to the previous behaviour instead of
 * dropping content.
 *
 * The read-first sentence is not decoration: pi's own probe found a bare pointer leaves a
 * non-reading model answering confidently and wrongly, while the same pointer with this sentence
 * makes it read. The language follows the document, through the detector the handoff shares.
 */
import { type DocumentLanguage } from "../shared/language.js";
/** One string per language; either can be rendered into the same slot. */
type LocalizedText = Record<DocumentLanguage, string>;
export interface InjectionSpec {
    /**
     * Headings declared as staying inline. The renderer does not branch on this: a heading with no
     * pointer is inline by construction, so the list states the intent and lets a test check coverage.
     */
    readonly keep: readonly string[];
    /** One line per indexed heading; a heading here must not also be kept. */
    readonly pointers: Readonly<Record<string, LocalizedText>>;
    /** Introduces the pointer list; `{path}` is replaced with the resolved path. */
    readonly heading: LocalizedText;
    /** The read-first sentence that follows the pointer list. */
    readonly instruction: LocalizedText;
    /** The path the pointers resolve to, shown to the reader. */
    readonly path: string;
}
/**
 * The body for one injected document: the preamble and every document-level note stay inline, the
 * kept sections follow in document order, and the sections with a pointer are reduced to one line
 * each. `root` is where the pointer path resolves when the caller knows the project root, because
 * the reader's `read` tool resolves relative paths against its own cwd, not against the directory
 * the injected prompt was built in. Returns the text unchanged when no section has a pointer.
 */
export declare function renderProgressiveBody(text: string, spec: InjectionSpec, language: DocumentLanguage, root?: string): string;
/** The project-relative path both injected documents live at. */
export declare const MEMORY_INJECTION_PATH = ".agents/memory/MEMORY.md";
export declare const CONTEXT_INJECTION_PATH = ".agents/memory/CONTEXT.md";
/** The two documents as they enter the system prompt. Exported so a test can pin the specs. */
export declare const MEMORY_INJECTION: InjectionSpec;
export declare const CONTEXT_INJECTION: InjectionSpec;
/** MEMORY.md as it enters the system prompt. */
export declare function buildMemoryInjection(text: string, projectRoot: string): string;
/** CONTEXT.md as it enters the system prompt, the same shape as the memory injection. */
export declare function buildContextInjection(text: string, projectRoot: string): string;
export {};
