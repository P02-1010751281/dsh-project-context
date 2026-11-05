// Authoritative integrity audit: hash-compare every installed package against its
// upstream tarball. Same method that proved the zod@4.6.2 truncation, but with a
// full per-file comparison instead of `diff -rq` + sed:
//
//   * `diff -rq` prints "Only in <subdir>: name" for NESTED differences, so a
//     top-level-only sed pattern silently reported 73/73 OK while
//     @deepseek-ai/dsh-package-manifest was demonstrably missing lib/index.js.
//   * it also prints "Files … differ" for content mismatches, which the first
//     version ignored entirely — exactly the partial-write shape NTFS produces.
//
// Classifications per package:
//   CLEAN    every upstream file present, no content difference
//   BROKEN   missing files and/or differing content  (the real defect)
//   EXTRAS   upstream matches but pnpm left extra files (informational)

import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const W = '/tmp/pnpm-store-audit';
const CACHE = join(W, 'cache');
const EXTRACT = join(W, 'extract');
mkdirSync(CACHE, { recursive: true });
mkdirSync(EXTRACT, { recursive: true });

const registry = execFileSync('npm', ['config', 'get', 'registry'], { encoding: 'utf8' }).trim().replace(/\/+$/, '');
const pkgs = readFileSync(join(W, 'packages.tsv'), 'utf8').trim().split('\n').map((line) => {
	const [name, version, dir] = line.split('\t');
	return { name, version, dir };
});

const safe = (s) => s.replace(/[/@]/g, '_');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function walk(dir, base = dir, out = new Map()) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const full = join(dir, e.name);
		const rel = relative(base, full);
		if (e.isSymbolicLink()) continue;
		if (e.isDirectory()) {
			if (e.name === 'node_modules') continue;
			walk(full, base, out);
		} else if (e.isFile()) out.set(rel, full);
	}
	return out;
}

function tarballUrl(name, version) {
	const base = name.includes('/') ? name.split('/')[1] : name;
	const scope = name.startsWith('@') ? name.split('/')[0] : '';
	return scope
		? `${registry}/${scope}/${base}/-/${base}-${version}.tgz`
		: `${registry}/${base}/-/${base}-${version}.tgz`;
}

async function audit(pkg) {
	const key = safe(`${pkg.name}@${pkg.version}`);
	const tgz = join(CACHE, `${key}.tgz`);
	const outDir = join(EXTRACT, key);
	if (!existsSync(tgz)) {
		const res = await fetch(tarballUrl(pkg.name, pkg.version));
		if (!res.ok) return { ...pkg, status: 'FETCH-FAIL', detail: `HTTP ${res.status}` };
		writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
	}
	if (!existsSync(outDir)) {
		mkdirSync(outDir, { recursive: true });
		try {
			execFileSync('tar', ['-xzf', tgz, '-C', outDir], { stdio: 'pipe' });
		} catch (err) {
			return { ...pkg, status: 'TAR-FAIL', detail: String(err).slice(0, 120) };
		}
	}
	const tops = readdirSync(outDir).filter((n) => statSync(join(outDir, n)).isDirectory());
	if (tops.length !== 1) return { ...pkg, status: 'TAR-FAIL', detail: `expected one top-level dir, got ${tops.length}: ${tops.join(',')}` };
	const upstreamRoot = join(outDir, tops[0]);

	const upstream = walk(upstreamRoot);
	const installed = walk(pkg.dir);

	// pnpm legitimately rewrites bin/ shims and may omit licence/notice text, so those
	// are reported separately. Everything else counts as a code defect: hiding it behind
	// a blanket exclusion is how a truncated install passes a "clean" audit.
	const isDoc = (rel) => /^(LICEN[CS]E|NOTICE|COPYING)(\.[A-Za-z]+)?$/i.test(rel);
	const isBin = (rel) => rel.startsWith('bin/');

	const missingCode = [];
	const missingDoc = [];
	const differCode = [];
	const binDiff = [];
	for (const [rel, upFile] of upstream) {
		const inst = installed.get(rel);
		if (!inst) {
			(isDoc(rel) ? missingDoc : missingCode).push(rel);
			continue;
		}
		const a = statSync(upFile);
		const b = statSync(inst);
		if (isBin(rel)) {
			// Only report a genuine difference: esbuild's own postinstall replaces its JS
			// shim with the platform binary, which is expected. Identical bin files are not
			// "transforms" and must not be labelled as such.
			if (a.size !== b.size || sha(upFile) !== sha(inst)) {
				binDiff.push(`${rel} (upstream ${a.size}B, installed ${b.size}B)`);
			}
			continue;
		}
		if (a.size !== b.size) differCode.push(`${rel} (size ${a.size} vs ${b.size})`);
		else if (sha(upFile) !== sha(inst)) differCode.push(`${rel} (same size, content differs)`);
	}
	const extras = [...installed.keys()].filter((rel) => !upstream.has(rel));

	const broken = missingCode.length + differCode.length > 0;
	return {
		...pkg,
		status: broken ? 'BROKEN' : extras.length || missingDoc.length ? 'NOTES' : 'CLEAN',
		missingCode,
		missingDoc,
		differCode,
		binDiff,
		extras,
		upstreamFiles: upstream.size,
	};
}

const results = [];
const queue = [...pkgs];
const workers = Array.from({ length: 8 }, async () => {
	while (queue.length) {
		const pkg = queue.shift();
		try {
			results.push(await audit(pkg));
		} catch (err) {
			results.push({ ...pkg, status: 'ERROR', detail: String(err).slice(0, 200) });
		}
	}
});
await Promise.all(workers);

results.sort((a, b) => a.name.localeCompare(b.name));
const byStatus = (s) => results.filter((r) => r.status === s);

console.log(`packages audited: ${results.length}`);
console.log(`registry: ${registry}`);
console.log('');
for (const status of ['BROKEN', 'FETCH-FAIL', 'TAR-FAIL', 'ERROR']) {
	const rows = byStatus(status);
	console.log(`${status}: ${rows.length}`);
	if (!rows.length) continue;
	for (const r of rows) {
		const counts =
			status === 'BROKEN'
				? `missing code ${r.missingCode.length}, differ ${r.differCode.length} (upstream ${r.upstreamFiles} files)`
				: (r.detail ?? '');
		console.log(`  ${r.name}@${r.version}  ${counts}`);
		for (const m of r.missingCode.slice(0, 20)) console.log(`      MISSING  ${m}`);
		if (r.missingCode.length > 20) console.log(`      … ${r.missingCode.length - 20} more missing`);
		for (const d of r.differCode.slice(0, 20)) console.log(`      DIFFER   ${d}`);
		if (r.differCode.length > 20) console.log(`      … ${r.differCode.length - 20} more differing`);
	}
}
console.log(`\nNOTES (missing licence/notice text and/or local extras, no code defect): ${byStatus('NOTES').length}`);
for (const r of byStatus('NOTES')) {
	const parts = [];
	if (r.missingDoc.length) parts.push(`missing doc ${r.missingDoc.join(',')}`);
	if (r.extras.length) parts.push(`extra ${r.extras.join(',')}`);
	console.log(`  ${r.name}@${r.version}  ${parts.join(' | ')}`);
}
const binRows = results.filter((r) => r.binDiff?.length);
console.log(`\nBIN TRANSFORMS (pnpm rewrote bin/ shims; not code defects): ${binRows.length}`);
for (const r of binRows) for (const b of r.binDiff) console.log(`  ${r.name}@${r.version}  ${b}`);
console.log(`\nCLEAN: ${byStatus('CLEAN').length}`);
const hard = byStatus('BROKEN').length + byStatus('FETCH-FAIL').length + byStatus('TAR-FAIL').length + byStatus('ERROR').length;
console.log(`\nVERDICT: ${hard === 0 ? 'NO CODE DEFECTS — every upstream source file present and byte-identical' : 'DEFECTS FOUND — see above'}`);

writeFileSync(join(W, 'audit-result.json'), JSON.stringify(results, null, 2));
