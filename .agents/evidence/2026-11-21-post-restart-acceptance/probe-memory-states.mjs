/**
 * Read-only enumeration of the current memory-entry states, using the same modules `/memory
 * reconcile` runs: loadMemory -> memoryEntryStates (entry-states.js), which calls the single arbiter
 * entryStateOf with the staleness / expiry facts. Prints the ids the user can hand to
 * `/memory reconcile --accept <id>`, and says which states that verb refuses (retiresEntry owns them).
 *
 * Usage: node probe-memory-states.mjs [--root <repo>]
 * Writes nothing; the sidecar is only read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
};
const root = option("root", "/mnt/Data/Projects/dsh-project-context");

const { DEFAULT_CONFIG } = await import(`${root}/lib/shared/config.js`);
const { loadMemory } = await import(`${root}/lib/project-memory/memory-store.js`);
const { memoryEntryStates } = await import(`${root}/lib/project-memory/entry-states.js`);
const { NON_RETIRING_STATES } = await import(`${root}/lib/project-memory/entry-state.js`);

/** The desktop profile's `project-context` config, read from the profile patch (read-only). */
function profileConfig(root) {
	const path = join(process.env.HOME, ".dsh", "profiles", "desktop", "cordis.patch.yml");
	const yml = readFileSync(path, "utf8");
	const block = yml.split(/\n- id: project-context\n/)[1]?.split(/\n- id: /)[0] ?? "";
	const values = {};
	for (const line of block.split("\n")) {
		const m = /^\s{4}([A-Za-z][\w]*):\s*(.+?)\s*$/.exec(line);
		if (m === null) continue;
		const raw = m[2].replace(/^["']|["']$/g, "");
		values[m[1]] = /^-?\d+$/.test(raw) ? Number(raw) : raw === "true" ? true : raw === "false" ? false : raw;
	}
	return { path, values };
}

const profile = profileConfig(root);
const config = { ...DEFAULT_CONFIG, ...profile.values };
const memory = await loadMemory(root, config.maxMemoryChars);
const states = await memoryEntryStates(root, memory.text, config);

const grouped = {};
for (const entry of states.entries) (grouped[entry.state] ??= []).push(entry);
const acceptables = states.entries
	.filter((entry) => NON_RETIRING_STATES.includes(entry.state))
	.map((entry) => entry.tid);

console.log(JSON.stringify({
	root,
	measuredAt: new Date().toISOString(),
	memoryFile: join(root, ".agents", "memory", "MEMORY.md"),
	config: {
		maxMemoryChars: config.maxMemoryChars,
		taskMode: config.taskMode,
		profilePath: profile.path,
		profileValues: profile.values,
	},
	checked: states.checked,
	cappedDroppedChars: memory.cappedDroppedChars,
	total: states.total,
	counts: Object.fromEntries(Object.entries(grouped).map(([state, list]) => [state, list.length])),
	byState: Object.fromEntries(Object.entries(grouped).map(([state, list]) => [state, list.map((e) => ({ tid: e.tid, detail: e.detail }))])),
	acceptList: acceptables,
	acceptCommand: acceptables.map((tid) => `/memory reconcile --accept ${tid}`).join("\n"),
	nonRetiringStates: NON_RETIRING_STATES,
}, null, "\t"));
