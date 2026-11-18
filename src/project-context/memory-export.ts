/**
 * `/context export` **core**: the `AGENTS.md`-compatible block, rendered from plain entries.
 *
 * The export exists for the other tools in a repository: a harness that reads `AGENTS.md` gets a
 * portable digest of this project's durable memory without having to know the `.agents/memory`
 * layout. What it must not become is a second source of truth — so it is generated, it names the file
 * it came from, and nothing ever writes back to it.
 *
 * Determinism is a contract, not an accident: the same entries always render the same bytes, which is
 * why the header carries no timestamp, no host name and no counts that are not derived from the
 * entries themselves. `/context export` printing twice and `--write` landing once must be the same
 * output, or a `--write` into a tracked file would dirty the tree on every run.
 *
 * Two knobs cross the boundary as data, never as imports: `mask` (the shim passes the package's
 * secret redactor, so the core owns no credential pattern) and `maxChars` (a portable digest is
 * bounded; the omission line says what stayed behind).
 */

/** One section of the digest, already in the order it should render. */
export interface ExportSection {
	/** The heading text as `MEMORY.md` spells it (`Project`, `Invariants`, `Pitfalls`). */
	readonly heading: string;
	/** Entry bodies, bullet markers already stripped by the reader. */
	readonly entries: readonly string[];
}

/** What the shim read out of `MEMORY.md`. */
export interface ExportDocument {
	/** Project-relative source path named in the header, e.g. `.agents/memory/MEMORY.md`. */
	readonly sourcePath: string;
	readonly sections: readonly ExportSection[];
}

export interface ExportOptions {
	/** Character budget for the entry lines alone; the header and the omission note sit outside it. */
	readonly maxChars?: number;
	/** Applied to every entry: the caller's secret redactor, so the core owns no credential pattern. */
	readonly mask?: (text: string) => string;
}

export interface ExportResult {
	readonly text: string;
	/** Entries that made it into the block. */
	readonly written: number;
	/** Entries the budget kept back; the text names where they still live. */
	readonly omitted: number;
}

export const DEFAULT_EXPORT_CHARS = 8_000;

/**
 * Render the digest.
 *
 * Entries are taken in document order and the walk stops at the first one that does not fit: skipping
 * ahead would produce a shorter digest whose selection no reader could explain, while truncating at a
 * boundary is a rule the omission line states.
 * @param doc - the sections the shim read.
 * @param options - budget and mask.
 * @returns the block, plus how many entries landed and how many stayed behind.
 */
export function renderMemoryExport(doc: ExportDocument, options: ExportOptions = {}): ExportResult {
	const maxChars = options.maxChars ?? DEFAULT_EXPORT_CHARS;
	const mask = options.mask ?? ((text: string): string => text);
	const header = [
		"## Project memory",
		"",
		`> Read-only digest of \`${doc.sourcePath}\`, for a tool that reads \`AGENTS.md\`. The source of truth stays that file; regenerate with \`/context export\`.`,
	].join("\n");
	const blocks: string[] = [header];
	let used = 0;
	let written = 0;
	let total = 0;
	let exhausted = false;
	for (const section of doc.sections) {
		total += section.entries.length;
		const lines: string[] = [];
		for (const entry of section.entries) {
			if (exhausted) continue;
			const body = mask(entry).replace(/\s+/g, " ").trim();
			if (body === "") continue;
			const line = `- ${body}`;
			if (used + line.length + 1 > maxChars) {
				exhausted = true;
				continue;
			}
			used += line.length + 1;
			written += 1;
			lines.push(line);
		}
		// A heading with no surviving entry is noise: it promises a section the budget emptied.
		if (lines.length > 0) blocks.push(`### ${section.heading}`, ...lines);
	}
	if (written < total) {
		const rest = total - written;
		blocks.push(`> ${rest} more entr${rest === 1 ? "y is" : "ies are"} in \`${doc.sourcePath}\`; this digest is bounded.`);
	}
	return { text: `${blocks.join("\n")}\n`, written, omitted: total - written };
}
