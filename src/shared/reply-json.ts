/**
 * Reading the structured reply out of a model response: a tolerant JSON object scan (models
 * wrap JSON in prose or fences), the string-field reader, and the consolidation parser whose
 * per-field verdicts the caller reports.
 */

export type ContextUpdate = {
	title: string;
	summary: string;
	key_points: string[];
	open_tasks: string[];
};

export type ConsolidationResult = {
	memory: string;
	context?: ContextUpdate;
	/**
	 * True when the reply carried a `context` the shape check refused: a non-object, a missing
	 * `summary`, or a `key_points`/`open_tasks` that is present but not an array of strings.
	 * Distinct from an absent `context`, which means the model chose to say nothing. A refused
	 * context leaves `context` undefined so the caller keeps the existing CONTEXT.md rather than
	 * overwriting it with hollowed-out fields, and the caller logs the fact once per project.
	 */
	contextUnusable?: boolean;
};

export function parseJsonObject(text: string): Record<string, unknown> | undefined {
	const candidate = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
	try {
		return JSON.parse(candidate) as Record<string, unknown>;
	} catch {
		// Fall through to a braced-object scan for models that add prose around the JSON.
	}
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/**
 * Read one `"key": "value"` string out of a reply whose object does not parse. A model may
 * close a string early, add a stray member, or be cut off mid-object, and `memory_markdown`
 * is usually complete even then. Undefined for a missing or unterminated value.
 */
function jsonStringField(text: string, key: string): string | undefined {
	const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
	if (!match) return undefined;
	let index = match.index + match[0].length;
	let out = "";
	while (index < text.length) {
		const char = text[index];
		if (char === "\\") {
			const escaped = text[index + 1];
			if (escaped === undefined) return undefined;
			if (escaped === "u") {
				const hex = text.slice(index + 2, index + 6);
				if (!/^[0-9a-f]{4}$/i.test(hex)) return undefined;
				out += String.fromCharCode(Number.parseInt(hex, 16));
				index += 6;
				continue;
			}
			out += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped === "r" ? "\r" : escaped;
			index += 2;
			continue;
		}
		if (char === '"') return out.trim();
		out += char;
		index += 1;
	}
	return undefined;
}

/** A reply that meant to be the requested JSON object; it must never be stored as memory. */
function looksLikeJsonReply(text: string): boolean {
	const candidate = text.replace(/^```(?:json)?\s*/i, "").trim();
	return candidate.startsWith("{") || /"memory_markdown"\s*:/.test(candidate);
}

/**
 * Read an optional list of strings out of a context field. `undefined` means the key was absent
 * (nothing to say), a string[] means it was usable, and `null` means it was present but
 * malformed — a caller must refuse the whole context rather than treat that as an empty list,
 * since doing the latter overwrites a good CONTEXT.md with hollowed-out sections.
 */
export function readContextList(value: unknown): string[] | null | undefined {
	if (value === undefined || value === null) return value === null ? null : undefined;
	if (!Array.isArray(value)) return null;
	if (!value.every((item): item is string => typeof item === "string")) return null;
	return value.length > 0 ? value : undefined;
}

/** Undefined means the pass must fail without touching MEMORY.md. */
export function parseConsolidation(text: string): ConsolidationResult | undefined {
	const parsed = parseJsonObject(text);
	if (parsed && typeof parsed.memory_markdown === "string") {
		const raw = parsed.context;
		// A `context` key that is absent or null is the model saying nothing: not an error. Any
		// other non-object, or an object that cannot yield a complete update, is unusable and is
		// reported rather than silently dropped.
		if (raw === undefined || raw === null) return { memory: parsed.memory_markdown };
		if (typeof raw !== "object") return { memory: parsed.memory_markdown, contextUnusable: true };
		const context = raw as Partial<ContextUpdate>;
		const keyPoints = readContextList(context.key_points);
		const openTasks = readContextList(context.open_tasks);
		if (typeof context.summary !== "string" || keyPoints === null || openTasks === null) {
			return { memory: parsed.memory_markdown, contextUnusable: true };
		}
		return {
			memory: parsed.memory_markdown,
			context: {
				title: typeof context.title === "string" ? context.title : "Untitled session",
				summary: context.summary,
				key_points: keyPoints ?? [],
				open_tasks: openTasks ?? [],
			},
		};
	}
	// A reply that failed to parse can still carry the memory field intact.
	const recovered = jsonStringField(text, "memory_markdown");
	if (recovered) return { memory: recovered };
	// Older or less capable models may still return Markdown directly.
	if (!looksLikeJsonReply(text)) return { memory: text };
	return undefined;
}
