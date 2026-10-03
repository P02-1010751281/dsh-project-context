// Client-half probe: typecheck `client/` against another dsh source tree's shipped client .d.ts.
// Read-only: writes only to /tmp.
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/mnt/Data/Projects/dsh-project-context';
const specifiers = process.argv[2].split(',');
const srcRepo = process.argv[3];
const out = process.argv[4];

function findDir(name) {
  const groups = fs.readdirSync(path.join(srcRepo, 'packages'), { withFileTypes: true });
  for (const g of groups) {
    if (!g.isDirectory()) continue;
    const gp = path.join(srcRepo, 'packages', g.name);
    for (const p of fs.readdirSync(gp, { withFileTypes: true })) {
      if (!p.isDirectory()) continue;
      const pj = path.join(gp, p.name, 'package.json');
      if (!fs.existsSync(pj)) continue;
      let m; try { m = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { continue; }
      if (m.name === name) return { dir: path.join(gp, p.name), m };
      const cand = path.join(gp, p.name, 'node_modules', name);
      if (fs.existsSync(path.join(cand, 'package.json'))) {
        return { dir: cand, m: JSON.parse(fs.readFileSync(path.join(cand, 'package.json'), 'utf8')) };
      }
    }
  }
  return undefined;
}

const paths = {};
const missing = [];
for (const spec of specifiers) {
  const slash = spec.indexOf('/', spec.startsWith('@') ? spec.indexOf('/') + 1 : 0);
  const name = slash === -1 ? spec : spec.slice(0, slash);
  const sub = slash === -1 ? undefined : spec.slice(slash + 1);
  const found = findDir(name);
  if (!found) { missing.push(spec); continue; }
  const entry = sub === undefined ? found.m.exports?.['.'] : found.m.exports?.[`./${sub}`];
  const types = entry?.types ?? (sub === undefined ? found.m.types : undefined);
  if (!types) { missing.push(`${spec} (no types: sub=${sub})`); continue; }
  paths[spec] = [path.join(found.dir, types.replace(/^\.\//, ''))];
}

const config = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    jsx: 'react-jsx',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    noUnusedLocals: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    forceConsistentCasingInFileNames: true,
    baseUrl: REPO,
    typeRoots: [path.join(REPO, 'node_modules/@types')],
    paths,
  },
  include: [path.join(REPO, 'client')],
};

fs.writeFileSync(out, JSON.stringify(config, null, 2));
console.log('mapped:', Object.keys(paths).join(', '));
console.log('missing:', missing.length ? missing.join(', ') : '(none)');
