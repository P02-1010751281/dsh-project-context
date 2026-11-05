// Restore files that the install dropped, from the integrity-verified upstream tarball.
//
// Only files reported by compare.mjs are copied, and every source is read from the
// extract directory of a tarball whose sha512 matched pnpm-lock.yaml, so this cannot
// introduce a file that upstream does not ship.

import { readFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const W = '/tmp/pnpm-store-audit';
const results = JSON.parse(readFileSync(join(W, 'audit-result.json'), 'utf8'));

const safe = (s) => s.replace(/[/@]/g, '_');
let restored = 0;
const log = [];

for (const r of results) {
	const missing = [...(r.missingCode ?? []), ...(r.missingDoc ?? [])];
	if (!missing.length) continue;
	const outDir = join(W, 'extract', safe(`${r.name}@${r.version}`));
	const tops = readdirSync(outDir).filter((n) => statSync(join(outDir, n)).isDirectory());
	if (tops.length !== 1) throw new Error(`${r.name}: expected one top-level dir, got ${tops.length}`);
	const upstreamRoot = join(outDir, tops[0]);
	for (const rel of missing) {
		const src = join(upstreamRoot, rel);
		const dst = join(r.dir, rel);
		if (!existsSync(src)) throw new Error(`refusing: ${src} does not exist upstream`);
		mkdirSync(dirname(dst), { recursive: true });
		copyFileSync(src, dst);
		restored++;
		log.push(`restored  ${r.name}@${r.version}  ${rel}`);
	}
}

console.log(log.join('\n'));
console.log(`\nfiles restored: ${restored}`);
