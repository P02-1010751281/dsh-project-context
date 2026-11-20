// Batch V preflight, post-implementation: count what the real binder would bind.
// Reads the built lib/ (not src/), so it measures the shipped rules.
import { stat } from "node:fs/promises";
import { loadMemory } from "../../../lib/project-memory/load.js";
import { sectionsFromMarkdown } from "../../../lib/project-memory/sections.js";
import { entryTid } from "../../../lib/project-memory/retirement.js";
import { bindableAnchors } from "../../../lib/project-memory/staleness-source.js";

const root = process.argv[2] ?? "/mnt/Data/Projects/dsh-project-context";
const sections = sectionsFromMarkdown((await loadMemory(root, 45000)).text);
let entries = 0, stamped = 0, anchored = 0, anchors = 0;
const files = new Set();
for (const key of Object.keys(sections)) {
	for (const entry of sections[key]) {
		entries += 1;
		if (entryTid(entry) === undefined) continue;
		stamped += 1;
		const paths = await bindableAnchors(entry, root);
		if (paths.length === 0) continue;
		anchored += 1;
		anchors += paths.length;
		for (const p of paths) files.add(p);
	}
}
let bytes = 0, largest = ["", 0];
for (const p of files) {
	const size = (await stat(`${root}/${p}`)).size;
	bytes += size;
	if (size > largest[1]) largest = [p, size];
}
console.log(JSON.stringify({
	entries,
	entriesCarryingAnId: stamped,
	entriesWithBindableAnchors: anchored,
	bindableAnchorInstances: anchors,
	bindableFiles: files.size,
	totalKB: +(bytes / 1024).toFixed(1),
	largest: { path: largest[0], kb: +(largest[1] / 1024).toFixed(1) },

}, null, 1));
