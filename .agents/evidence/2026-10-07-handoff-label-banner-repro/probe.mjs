// Read-only probe: is the banner filter in `handoffLabel` reachable on the real corpus, and does the
// built function actually reject the banners the pre-fix (kind-only) filter accepted?
//
// It folds every archived session of THIS workspace, reconstructs each handoff child's PARENT as the
// minimal session shape `handoffLabel` reads (`deriveMessages()`), and runs the **built** function from
// `lib/` on it. Alongside it computes the pre-fix semantics locally (`source.kind === "user"` only) and
// asserts the two differ exactly on the banner rows — so the probe fails if the corpus stops exercising
// the class (fixture gone stale) and fails if the built function stops rejecting it (fix reverted).
//
// Run:  node .agents/evidence/2026-10-07-handoff-label-banner-repro/probe.mjs
// No writes, no network. `zstdcat` must be on PATH; the store is read-only input.
import { readdirSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { handoffLabel } from '../../../lib/project-handoff/conversation.js'
import { isHandoffContinuationText } from '../../../lib/project-handoff/language.js'
import { clipTitle } from '../../../lib/shared/text.js'

const PRE = '\u21aa handoff \u00b7 '
const STORE = join(homedir(), '.dsh/sessions/--mnt-Data-Projects-dsh-project-context--')
/** Mirrors `HANDOFF_LABEL_CHARS`; only the printed form depends on it, not the difference test. */
const LABEL_CHARS = 20

function textOf(blocks) {
  return (blocks ?? [])
    .filter((b) => b !== null && typeof b === 'object' && b.type === 'text')
    .map((b) => String(b.text ?? ''))
    .join('\n')
    .trim()
}

/**
 * For a child, the parent id as its own seed banner names it: `从会话 <id> 交接。` / `Handoff from
 * session <id>.` The banner writes `String(session.id)`, which carries the literal `session-` for
 * every archived seed (97/97 measured), and this map's keys are the store's directory names with that
 * prefix removed — hence the optional group. This is the authoritative link and it keeps working after
 * this batch is loaded: a child's *title* carries the parent id only while it is a pre-fix id-titled
 * child.
 */
const SEED_PARENT = /^(?:\u4ece\u4f1a\u8bdd|Handoff from session)\s+(?:session-)?([0-9a-fA-F][0-9a-fA-F-]{7,})/
/** How many leading `user/message` events are searched for the seed banner (context may precede it). */
const SEED_SCAN_MESSAGES = 5

/** Fold one session log into `{title, messages, kinds, seedParent}`. */
function scan(file) {
  return new Promise((resolve) => {
    const out = { title: null, messages: [], kinds: new Map(), seedParent: null }
    const child = spawn('zstdcat', [file], { stdio: ['ignore', 'pipe', 'ignore'] })
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.includes('"session/title"') && !line.includes('"user/message"')) return
      let event
      try { event = JSON.parse(line) } catch { return }
      const data = event.data ?? {}
      if (event.type === 'session/title') { out.title = data.title; return }
      const kind = data.source?.kind ?? '<none>'
      out.kinds.set(kind, (out.kinds.get(kind) ?? 0) + 1)
      out.messages.push({ role: 'user', source: { kind }, content: data.content ?? [] })
      if (out.seedParent === null && out.messages.length <= SEED_SCAN_MESSAGES) {
        const match = SEED_PARENT.exec(textOf(data.content))
        if (match !== null) out.seedParent = match[1]
      }
    }).on('close', () => resolve(out))
    child.on('error', () => resolve(out))
  })
}

/** Classify a label so "banner" is distinguishable from "useful"/"no source". */
function klass(label, fallback) {
  if (label === fallback) return 'no-source (falls back to the parent id)'
  if (label.startsWith('\u4ece\u4f1a\u8bdd session-')) return 'BANNER (pre-fix bug)'
  if (label === '\u7ee7\u7eed') return 'noise: "继续"'
  if (label.length <= 4) return 'noise: <=4 chars'
  return 'useful: a real instruction'
}

/** The pre-fix reader: `source.kind === "user"` only, no banner filter. */
function lastKindUserText(messages) {
  let last = ''
  for (const m of messages) {
    if (m.source.kind !== 'user') continue
    const text = textOf(m.content)
    if (text.length > 0) last = text
  }
  return last
}

function preFixLabel(messages, fallback) {
  const last = lastKindUserText(messages)
  return last.length === 0 ? fallback : clipTitle(last, LABEL_CHARS)
}

const sessions = new Map()
for (const name of readdirSync(STORE).filter((n) => n.startsWith('session-'))) {
  const base = join(STORE, name)
  const file = ['session.v4.jsonl.zstd', 'session.jsonl.zstd', 'session.v4.jsonl', 'session.jsonl']
    .map((f) => join(base, f)).find((f) => existsSync(f))
  sessions.set(name.slice('session-'.length), file === undefined ? { missing: true } : await scan(file))
}
const parentOf = (label) => { for (const [id, row] of sessions) if (id.startsWith(label)) return [id, row]; return [] }
const kids = [...sessions.entries()].filter(([, row]) => typeof row.title === 'string' && row.title.startsWith(PRE))
/**
 * The parent of one child: its seed banner's id first, else the id its title still carries. Both are
 * resolved through `parentOf` (an exact id, or a longer title-derived id for pre-fix children). The
 * seed path is what keeps this check working once children stop being titled with the parent id.
 */
const parentRow = (row) => {
  const seed = row.seedParent
  if (seed !== null) { const found = parentOf(seed); if (found.length > 0) return [...found, 'seed'] }
  const titled = parentOf(row.title.slice(PRE.length).trim())
  return titled.length > 0 ? [...titled, 'title'] : []
}

const census = new Map()
for (const [, row] of sessions) for (const [k, n] of row.kinds ?? []) census.set(k, (census.get(k) ?? 0) + n)
console.log('source.kind on user/message across the store (the premise of the kind filter):')
for (const [k, n] of [...census].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${JSON.stringify(k)}`)
const premise = census.has('runtime-context') && census.has('dsh-project-context')
console.log(`  -> premise (injected snapshots and current seeds carry their own kinds): ${premise ? 'holds' : 'FAILED'}`)

const rows = []
const bannerKids = []
const via = new Map()
for (const [childId, row] of kids) {
  const found = parentRow(row)
  if (found.length === 0) { via.set('unresolved', (via.get('unresolved') ?? 0) + 1); continue }
  const [parentId, parent, how] = found
  via.set(how, (via.get(how) ?? 0) + 1)
  if (parent.missing) continue
  const fallback = parentId.slice(0, 8)
  const post = handoffLabel({ deriveMessages: () => parent.messages }, fallback)
  const pre = preFixLabel(parent.messages, fallback)
  const raw = lastKindUserText(parent.messages)
  const banner = isHandoffContinuationText(raw)
  // The class the regression test pins: the parent's last human-*kind* message is its own old seed.
  if (banner) bannerKids.push({ childId, fallback, pre, post, rawLabel: raw.length === 0 ? fallback : clipTitle(raw, LABEL_CHARS) })
  if (pre !== post) rows.push({ childId, parentId, fallback, pre, post, banner })
}

const counts = new Map()
for (const [childId, row] of kids) {
  const found = parentRow(row)
  const parentId = found.length === 0 ? undefined : found[0]
  const parent = found.length === 0 ? undefined : found[1]
  const fallback = parentId === undefined ? childId.slice(0, 8) : parentId.slice(0, 8)
  const post = parentId === undefined || parent.missing
    ? fallback
    : handoffLabel({ deriveMessages: () => parent.messages }, fallback)
  const key = klass(post, fallback)
  counts.set(key, (counts.get(key) ?? 0) + 1)
}
console.log('')
console.log(`handoff children folded: ${kids.length}`)
console.log(`parent resolved via: ${JSON.stringify([...via.entries()])}`)
console.log('labels the BUILT `handoffLabel` produces for them (this is what the sidebar will show):')
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`)

console.log('')
console.log(`rows where the pre-fix (kind-only) filter differs from the built function: ${rows.length}`)
for (const r of rows) {
  console.log(`  child ${r.childId.slice(0, 8)}  parent ${r.parentId.slice(0, 8)}`)
  console.log(`      pre-fix : ${JSON.stringify(r.pre)}`)
  console.log(`      built   : ${JSON.stringify(r.post)}`)
}

console.log('')
console.log(`children whose parent's last human-kind message is a banner (predicate): ${bannerKids.length}`)
for (const r of bannerKids) {
  console.log(`  child ${r.childId.slice(0, 8)}  if the banner were used: ${JSON.stringify(r.rawLabel)}  -> built: ${JSON.stringify(r.post)}`)
}

const problems = []
if (!premise) problems.push('the kind filter premise no longer holds for this store')
if (bannerKids.length === 0) problems.push('the corpus no longer exercises the class: the regression fixture is stale')
// Independent of the pre/post comparison, so it still fires when the filter is removed from lib/.
for (const r of bannerKids) {
  if (r.post === r.rawLabel) problems.push(`the built function still labels child ${r.childId.slice(0, 8)} after its parent's banner`)
}
if (rows.some((r) => !r.banner)) problems.push('a "difference" row is not explained by the banner predicate')
console.log('')
if (problems.length > 0) {
  for (const p of problems) console.log(`FAIL: ${p}`)
  process.exit(1)
}
console.log(`PASS: ${bannerKids.length} real children have a banner as their parent's last human-kind message,`)
console.log(`      the built \`handoffLabel\` rejects every one, and ${rows.length} rows show the filter changing the outcome`)
