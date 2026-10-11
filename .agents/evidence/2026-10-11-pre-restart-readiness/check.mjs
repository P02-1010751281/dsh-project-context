#!/usr/bin/env node
/**
 * Pre-restart readiness check (dsh-project-context) — read-only, never restarts anything.
 *
 * Why it exists: batches N/O/Q/R all changed `src/` on 2026-10-10/11 and only a desktop restart makes
 * them live. Two questions must be answered *before* handing that restart to the user, and both have
 * been answered wrongly by quoting an older turn:
 *
 *   1. the load criterion — the process holding 127.0.0.1:19387 started *after* the last `src/`
 *      commit. It is a whole-tree criterion: it cannot name *which* landed batch is live. Compare
 *      each batch's own commit time against the holder's start to attribute per batch (2026-10-11:
 *      holder 10:44:21, so batch N's 08:34/08:54 are inside it and O/Q/R's 10:51/11:22/11:54 are not).
 *   2. the restart target — `/etc/nixos/scripts/dsh-desktop-restart.sh` launches
 *      `~/.nix-profile/bin/dsh-desktop`, which can point at a *different* store than the running
 *      instance (the launcher-cache trap that script exists to undo). A second live desktop also makes
 *      the script's `--verify-only` print FAIL no matter how correct our restart was.
 *
 * Usage:  node .agents/evidence/2026-10-11-pre-restart-readiness/check.mjs [--port 19387]
 *                                                                       [--no-plugin-check]
 * Exit:   0 = criterion positive (the last `src/` commit is live) and `lib/` is clean
 *         1 = criterion negative (nothing new is live) — the expected pre-restart reading
 *         2 = indeterminate (not the repo root, or nothing listening on the port)
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const port = opt('--port', '19387')
const pluginCheck = !argv.includes('--no-plugin-check')

const root = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '')
const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

// ---- 0. are we where the probe thinks we are? (a probe judging the wrong repo proves nothing) ----
const pkg = run('git', ['-C', root, 'rev-parse', '--show-toplevel'])
if (pkg !== root) {
  console.error(`not the repo root: expected ${root}, git says ${pkg ?? '(no git)'}`)
  process.exit(2)
}
console.log(`repo       ${root}`)
console.log(`listener   --port ${port}`)

// ---- 1. the load criterion (locale-safe: holder start = now - etimes, never ps's lstart text) ----
let holderPid = null
const ss = run('ss', ['-ltnp'])
if (ss !== null) {
  for (const line of ss.split('\n')) {
    if (!line.includes(`:${port} `)) continue
    const m = /pid=(\d+)/.exec(line)
    if (m !== null) { holderPid = m[1]; break }
  }
}
let holderEpoch = null
if (holderPid !== null) {
  const etimes = run('ps', ['-o', 'etimes=', '-p', holderPid])
  const secs = Number((etimes ?? '').trim())
  if (Number.isFinite(secs) && secs > 0) holderEpoch = Math.floor(Date.now() / 1000) - secs
}

const srcHash = run('git', ['log', '-1', '--format=%h', '--', 'src/'])
const srcIso = run('git', ['log', '-1', '--format=%cI', '--', 'src/'])
const srcEpoch = Number(run('git', ['log', '-1', '--format=%ct', '--', 'src/']))
const fmt = (e) => (Number.isFinite(e) ? new Date(e * 1000).toLocaleString('sv-SE') : '?')

console.log('\n== 1. load criterion (whole tree) ==')
console.log(`holder     pid=${holderPid ?? 'none'}  started ${fmt(holderEpoch)}`)
console.log(`last src/  ${srcHash ?? '?'}  committed ${srcIso ?? '?'}`)

if (holderEpoch === null) {
  console.log(`VERDICT: INDETERMINATE — nothing is listening on 127.0.0.1:${port} (or ps/ss gave no start time)`)
} else if (holderEpoch > srcEpoch) {
  console.log('VERDICT: POSITIVE — the last src/ commit is live')
} else {
  console.log('VERDICT: NEGATIVE — the holder started before the last src/ commit; a restart is what makes it live')
}

// ---- 6. per-batch attribution: the whole-tree verdict cannot name a batch; commit times can ----
console.log('\n== 2. per-batch attribution (holder start vs each batch\'s own src/ commit) ==')
const batches = run('git', ['log', '--format=%h %ct %cI %s', '-8', '--', 'src/'])
if (batches === null) console.log('  (no src/ history)')
else {
  for (const line of batches.split('\n')) {
    const [hash, epoch, iso, ...subject] = line.split(' ')
    const t = Number(epoch)
    const state = holderEpoch === null ? '?' : t < holderEpoch ? 'IN the holder (live)' : 'AFTER the holder (not live)'
    console.log(`  ${state.padEnd(32)} ${hash}  ${iso}  ${subject.join(' ')}`)
  }
}

// ---- 3. is lib/ what src/ compiles to? (the second half of the criterion) ----
console.log('\n== 3. lib/ build state ==')
try {
  execFileSync('git', ['diff', '--exit-code', '--', 'lib'], { cwd: root, stdio: 'ignore' })
  console.log('git diff --exit-code -- lib : clean')
} catch {
  console.log('git diff --exit-code -- lib : DIRTY — rebuild and commit lib/ with src/ before any restart')
}

// ---- 4. restart target vs live instance (the script's own second criterion, and its known FAIL) ----
console.log('\n== 4. restart target vs live stores ==')
const storeOf = (p) => /\/nix\/store\/([a-z0-9]+-dsh-desktop-[^/\s]+)/.exec(p)?.[1] ?? null
let expected = null
try { expected = storeOf(realpathSync(join(homedir(), '.nix-profile/bin/dsh-desktop'))) } catch { /* wrapper missing */ }
const live = new Map()
for (const pid of readdirSync('/proc')) {
  if (!/^\d+$/.test(pid)) continue
  let text
  try { text = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ') } catch { continue }
  const isElectronMain = /libexec\/electron\/electron/.test(text) && /\/apps\/desktop(\s|$)/.test(text) && !/--type=/.test(text)
  const isHost = /dsh-desktop-host\/lib\/index\.js/.test(text) && /nodejs-official/.test(text)
  if (!isElectronMain && !isHost) continue
  const store = storeOf(text)
  if (store === null) continue
  live.set(store, [...(live.get(store) ?? []), `${isElectronMain ? 'electron' : 'host'}:${pid}`])
}
console.log(`wrapper    ${expected ?? 'unresolvable'}`)
for (const [store, who] of live) console.log(`  ${store === expected ? '=' : '!'} ${store}  (${who.join(', ')})`)
if (expected !== null && live.size > 0 && !live.has(expected)) {
  console.log('  ! the wrapper store is not running: a restart moves the desktop onto it (that is the point')
  console.log('    of the script, but the running core then changes — verify it after the restart)')
}
if (live.size > 1) {
  console.log('  ! more than one store is alive ⇒ dsh-desktop-restart.sh --verify-only prints FAIL even')
  console.log('    after a correct restart; accept through the criterion above / --expect-store off instead')
}

// ---- 5. is our plugin actually active in that host? (read-only, needs the stored HMAC secret) ----
if (pluginCheck) {
  console.log('\n== 5. live plugin activation (host inventory) ==')
  const probe = '/etc/nixos/scripts/dsh-live-inventory-probe.mjs'
  try {
    const out = execFileSync(process.execPath, [probe, '--url', `http://127.0.0.1:${port}`,
      '--expect', 'dsh-project-context', '--expect-store', 'off'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    process.stdout.write(out)
  } catch (err) {
    process.stdout.write(err.stdout ?? '')
    process.stderr.write(err.stderr ?? '')
    console.log(`  (inventory probe exit ${err.status ?? '?'} — host not ready, or the plugin is not active)`)
  }
}

process.exit(holderEpoch === null ? 2 : holderEpoch > srcEpoch ? 0 : 1)
