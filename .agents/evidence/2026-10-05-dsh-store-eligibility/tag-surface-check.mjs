// Check the *released tag's* tree, not the working tree: DSH STORE reads a fixed Git Commit and never
// runs install / prepare / build, so the artifact surface has to be resolvable inside the tag itself.
//
//   node .agents/evidence/2026-10-05-dsh-store-eligibility/tag-surface-check.mjs v0.4.1
//
// Mirrors `src/package-source-surface.mjs` at DSH-Store revision 77743a8 for the manifest-level part:
// every declared entry (`main` / `module` / `types` / `exports` / `bin` / `dsh.bundle.patch`) must exist
// as a blob in that tree, and the shipped bin's relative imports must resolve there too.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ref = process.argv[2];
if (!ref) {
  console.error('usage: node tag-surface-check.mjs <git-ref>');
  process.exit(2);
}
const repo = resolve(new URL('../../..', import.meta.url).pathname);
const root = mkdtempSync(join(tmpdir(), 'tag-surface-'));
try {
  // `git archive` carries the tree with its modes, so the bin's executable bit is checked for real.
  const tar = execFileSync('git', ['-C', repo, 'archive', ref], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', root], { input: tar });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  const declared = new Map();
  const add = (label, p) => {
    if (typeof p === 'string') declared.set(label, p);
  };
  const walk = (node, path) => {
    if (typeof node === 'string') add(`exports${path}`, node);
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  };
  walk(pkg.exports ?? {}, '');
  for (const field of ['main', 'module', 'types']) add(field, pkg[field]);
  for (const [name, p] of Object.entries(pkg.bin ?? {})) add(`bin.${name}`, p);
  add('dsh.bundle.patch', pkg.dsh?.bundle?.patch);

  let missing = 0;
  for (const [label, rel] of declared) {
    const ok = existsSync(resolve(root, rel)) && statSync(resolve(root, rel)).isFile();
    if (!ok) missing += 1;
    console.log(`${ok ? 'ok  ' : 'MISS'} ${label.padEnd(34)} ${rel}`);
  }

  // The packaged bin is what `files` ships; its relative imports must resolve inside the tree, and its
  // executable bit is what `nativeOrExecutableArtifacts` reacts to — dropping it breaks the installed CLI.
  let unresolved = 0;
  let notExecutable = 0;
  const binRel = pkg.bin?.['dsh-project-archives'];
  if (binRel) {
    const executable = (statSync(join(root, binRel)).mode & 0o111) !== 0;
    if (!executable) notExecutable += 1;
    console.log(`${executable ? 'ok  ' : 'MISS'} bin mode executable ${binRel}`);
    const binSrc = readFileSync(join(root, binRel), 'utf8');
    const rels = [...binSrc.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    for (const rel of new Set(rels)) {
      const ok = existsSync(resolve(dirname(join(root, binRel)), rel));
      if (!ok) unresolved += 1;
      console.log(`${ok ? 'ok  ' : 'MISS'} bin-import ${rel}`);
    }
  }

  const libDir = join(root, 'lib');
  const libFiles = existsSync(libDir) ? readdirSync(libDir, { recursive: true }).filter((p) => statSync(join(libDir, p)).isFile()).length : 0;
  console.log(`\n${ref}: lib files ${libFiles}; missing entry points ${missing}/${declared.size}; unresolved bin imports ${unresolved}; bin not executable ${notExecutable}`);
  process.exit(missing === 0 && unresolved === 0 && notExecutable === 0 ? 0 : 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
