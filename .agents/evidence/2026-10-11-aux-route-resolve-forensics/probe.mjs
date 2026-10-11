#!/usr/bin/env node
/**
 * Why the 2026-10-11 16:54:50/51Z `MissingSessionID` pair is not an anomaly, and which sessions
 * could have produced it. Read-only; never writes to the repo or to `~/.dsh`.
 *
 * The tracked `CONTEXT.md` used to say those two 400s came from a dispose-time pass of
 * `session-d435cad7` and that the auxiliary route therefore "may lag the session's selection" —
 * an admitted *hypothesis*. Both halves of that are now decidable, so this probe decides them with
 * two independent claims, each with its own falsifier:
 *
 *   A. Load state. The stack in `.agents/memory/errors.log` names five `lib/…` frames. In the
 *      PRE-fix build (`<fix>^`) each of those line numbers is the call site the frame names; in the
 *      build that carries the fix (`<fix>`) each of those line numbers is something else (a comment,
 *      a closing brace, or a different statement). So the two 400s were produced by pre-fix code:
 *      the known pre-fix behaviour, not a post-fix regression. This half deliberately does NOT read
 *      the socket holder's start time — the stack itself discriminates, and the holder's start can
 *      move again.
 *
 *   B. Route. `resolveTarget` (src/shared/model-call.ts) resolves config → `requestHeader()?.config`
 *      → `agent.options`, and `requestHeader()` is the fold of `request/header` events — i.e. the
 *      header of the session's last DISPATCHED request (`packages/core/session/src/index.ts`), not
 *      the current `model/selection` (which model-selection's `agent/request` hook applies per
 *      dispatch, `packages/core/agent/src/model-selection.ts`). So a session that switched route but
 *      has not dispatched since still resolves to the OLD provider. Fold every session's headers at
 *      the cut moment: `session-d435cad7` — the session CONTEXT.md blames — was already on
 *      `command-code`, whose adapter never emits `MissingSessionID`; the sessions still resolving to
 *      `opencode-go` are the only candidates.
 *
 * Usage:  node .agents/evidence/2026-10-11-aux-route-resolve-forensics/probe.mjs
 * Exit:   0 = both halves PASS   1 = a falsifier fired   2 = indeterminate (input missing)
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const repo = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '')
const store = join(homedir(), '.dsh/sessions/--mnt-Data-Projects-dsh-project-context--')
/** `--fix=<rev>` / `--cut=<iso>` exist so each falsifier can be shown firing (see the README). */
const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}
/** The fix commit whose parent produced the two 400s. */
const FIX = opt('fix', '0bf0b31')
/** The moment the second of the two 400s was logged (errors.log stamps UTC; this is the same instant in +08). */
const CUT = Date.parse(opt('cut', '2026-10-11T16:54:50+08:00'))
/** Only sessions touched this late can hold a route that was in force at CUT. */
const SINCE = Date.parse('2026-10-11T15:00:00+08:00')
/** The session the tracked CONTEXT.md blames, and the provider whose adapter answers `MissingSessionID`. */
const BLAMED = 'session-d435cad7-cb42-4701-943c-ff4c3a3ad8ca'
const BAD_PROVIDER = 'opencode-go'

const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
const show = (rev, file) => git(['show', `${rev}:${file}`])
const lineOf = (text, n) => (text.split('\n')[n - 1] ?? '')
const local = (ms) => new Date(ms).toLocaleString('sv-SE')
const squash = (text) => text.replace(/\s+/g, '')
/** The call the line executes, e.g. `throw Object.assign(…)` -> `Object.assign(`; null when it calls nothing. */
const tokenOf = (line) => {
  const stripped = line
    .trim()
    .replace(/^(?:return|throw)\s+/, '')
    .replace(/^(?:const|let|var)\s+[\w$]+\s*=\s*/, '')
  const m = /([A-Za-z_$][\w$.]*)\s*\(/.exec(stripped)
  return m === null ? null : `${m[1]}(`
}

let failed = false
const verdict = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!ok) failed = true
}

// ---------------------------------------------------------------- A. which build produced the stack
console.log('== A. load state: does the logged stack match the PRE-fix build? ==')
const errors = readFileSync(join(repo, '.agents/memory/errors.log'), 'utf8').split('\n')
const headers = errors.map((line, i) => (line.includes('MissingSessionID') && /^\d{4}-/.test(line) ? i : -1)).filter((i) => i >= 0)
if (headers.length === 0) {
  console.log('  INDETERMINATE — errors.log carries no MissingSessionID line to attribute')
  process.exit(2)
}
console.log(`  errors.log carries ${headers.length} MissingSessionID line(s); the last is at ${errors[headers.at(-1)].slice(0, 24)}`)
// The frames of the LAST trace: from its own header line to the end of its stack block.
const block = errors.slice(headers.at(-1)).filter((line) => line.trimStart().startsWith('at '))
const frames = []
for (const line of block) {
  const m = /(lib\/[a-z/-]+\.js):(\d+):(\d+)/.exec(line)
  if (m !== null) frames.push({ file: m[1], line: Number(m[2]), col: Number(m[3]) })
}
for (const f of frames) {
  const pre = lineOf(show(`${FIX}^`, f.file), f.line)
  const post = lineOf(show(FIX, f.file), f.line)
  // The discriminator is the call the frame names, not "is it a comment": the post-fix line at the
  // same number is sometimes real code (`throw error;`) that simply is not that call.
  const token = tokenOf(pre)
  console.log(`  ${f.file}:${f.line}:${f.col}   [token ${token ?? '(none)'}]`)
  console.log(`      ${FIX}^  ${pre.trim().slice(0, 96)}`)
  console.log(`      ${FIX}    ${post.trim().slice(0, 96)}`)
  verdict(
    token !== null && squash(pre).includes(token) && !squash(post).includes(token),
    `${f.file}:${f.line} is the ${token ?? '?'} call site at ${FIX}^ and not at ${FIX}`,
  )
}

// ---------------------------------------------------------------- B. which route each session resolved to
console.log('\n== B. route: what did `requestHeader()` fold to at the cut? ==')
const sessions = readdirSync(store)
  .map((id) => ({ id, file: join(store, id, 'session.v4.jsonl.zstd') }))
  .filter(({ file }) => {
    try {
      return statSync(file).mtimeMs >= SINCE
    } catch {
      return false
    }
  })
const table = []
for (const { id, file } of sessions) {
  let text
  try {
    text = execFileSync('zstd', ['-dc', file], { encoding: 'utf8', maxBuffer: 1 << 30 })
  } catch {
    continue
  }
  let inForce
  const selections = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let ev
    try {
      ev = JSON.parse(raw)
    } catch {
      continue
    }
    if (ev.type === 'request/header') {
      const config = ev.data?.header?.config ?? ev.data?.config
      if (config && ev.time <= CUT) inForce = { time: ev.time, provider: config.provider, model: config.model }
    } else if (ev.type === 'model/selection') {
      selections.push({ time: ev.time, provider: ev.data?.provider, model: ev.data?.model })
    }
  }
  if (inForce === undefined && selections.length === 0) continue
  table.push({ id, inForce, selections })
  const route = inForce === undefined ? '(no header before the cut → falls through to agent.options)' : `${inForce.provider}/${inForce.model} @ ${local(inForce.time)}`
  console.log(`  ${id}`)
  console.log(`      in force at cut: ${route}`)
  for (const s of selections) console.log(`      selection      : ${s.provider}/${s.model} @ ${local(s.time)}`)
}

const blamed = table.find((r) => r.id === BLAMED)
if (blamed === undefined) {
  console.log(`  INDETERMINATE — the blamed session ${BLAMED} is not in the store window`)
  process.exit(2)
}
verdict(
  blamed.inForce !== undefined && blamed.inForce.provider !== BAD_PROVIDER,
  `the blamed session's in-force route at the cut is '${blamed.inForce?.provider ?? '(none)'}'; it must not be ${BAD_PROVIDER}`,
)
const candidates = table.filter((r) => r.inForce?.provider === BAD_PROVIDER).map((r) => r.id)
verdict(candidates.length > 0, `sessions still resolving to ${BAD_PROVIDER} at the cut: ${candidates.join(', ') || '(none)'}`)

console.log(`\nRESULT: ${failed ? 'FAIL' : 'PASS'}`)
process.exit(failed ? 1 : 0)
