// Build a probe tsconfig that typechecks this repo's host half against another dsh source tree's
// shipped .d.ts files. Read-only: writes only to /tmp.
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/mnt/Data/Projects/dsh-project-context';
const needed = process.argv[2].split(',');
const srcRepo = process.argv[3];
const out = process.argv[4];

function indexPackages(root) {
  const index = new Map();
  const groups = fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true });
  for (const g of groups) {
    if (!g.isDirectory()) continue;
    const gp = path.join(root, 'packages', g.name);
    for (const p of fs.readdirSync(gp, { withFileTypes: true })) {
      if (!p.isDirectory()) continue;
      const pj = path.join(gp, p.name, 'package.json');
      if (!fs.existsSync(pj)) continue;
      let m; try { m = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { continue; }
      if (typeof m.name === 'string') index.set(m.name, path.join(gp, p.name));
    }
  }
  return index;
}

const index = indexPackages(srcRepo);
// Peer packages (cordis, schemastery) are not under packages/*/*; the dsh packages resolve them
// from their own node_modules, and module identity must match or Context augmentation is lost.
function findPeer(name) {
  const groups = fs.readdirSync(path.join(srcRepo, 'packages'), { withFileTypes: true });
  for (const g of groups) {
    if (!g.isDirectory()) continue;
    const gp = path.join(srcRepo, 'packages', g.name);
    for (const p of fs.readdirSync(gp, { withFileTypes: true })) {
      if (!p.isDirectory()) continue;
      const cand = path.join(gp, p.name, 'node_modules', name);
      if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
    }
  }
  return undefined;
}

const paths = {};
const missing = [];
for (const name of needed) {
  const dir = index.get(name) ?? findPeer(name);
  if (!dir) { missing.push(name); continue; }
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const types = m.exports?.['.']?.types ?? m.types;
  if (!types) { missing.push(`${name} (no types entry)`); continue; }
  paths[name] = [path.join(dir, types.replace(/^\.\//, ''))];
}

const config = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    lib: ['ES2023'],
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    verbatimModuleSyntax: true,
    noUnusedLocals: true,
    noEmit: true,
    baseUrl: REPO,
    typeRoots: [path.join(REPO, 'node_modules/@types')],
    types: ['node'],
    paths,
  },
  include: [path.join(REPO, 'src')],
};

fs.writeFileSync(out, JSON.stringify(config, null, 2));
console.log('mapped:', Object.keys(paths).join(', '));
console.log('missing:', missing.length ? missing.join(', ') : '(none)');
console.log('wrote', out);
