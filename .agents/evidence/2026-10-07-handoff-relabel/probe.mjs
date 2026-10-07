// Read-only probe + acceptance control for the deferred continuation title (`relabel.ts`).
//
// It folds every archived session of THIS workspace, reconstructs each handoff child's own message list
// in the shape `deferredHandoffLabel` reads (`deriveMessages()`), and runs the **built** functions from
// `lib/` on it: `deferredHandoffLabel` for the label, `storedHandoffLabel` for the prefix test the
// rewrite is gated on. Alongside it computes the pre-fix semantics locally (first `kind=user` message,
// banner filter absent) and asserts the built function never picks the banner — so the probe fails if
// the corpus stops exercising the class, and fails if the banner filter is reverted.
//
// Run:  node .agents/evidence/2026-10-07-handoff-relabel/probe.mjs
// Build first (`pnpm build`): the probe judges `lib/`, so a stale build judges stale behaviour.
// No writes, no network. `zstdcat` must be on PATH; the store is read-only input.
import { readdirSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { deferredHandoffLabel } from '../../../lib/project-handoff/conversation.js'
import { SCAFFOLDING, isHandoffContinuationText } from '../../../lib/project-handoff/language.js'
import { storedHandoffLabel } from '../../../lib/project-handoff/relabel.js'
import { clipTitle } from '../../../lib/shared/text.js'

/** `↪ handoff · ` — the literal in `src/project-handoff/marker.ts`. */
const PRE = '\u21aa handoff \u00b7 '
/** Mirrors `HANDOFF_LABEL_CHARS`; the built function is the authority, this only judges its output. */
const LABEL_CHARS = 20
/** Workspace store directory; the id shape is `--<cwd with / -> ->`--`. */
const STORE = join(homedir(), '.dsh/sessions/--mnt-Data-Projects-dsh-project-context--')

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  — ${detail}`}`)
}

function textOf(blocks) {
  return (blocks ?? [])
    .filter((b) => b !== null && typeof b === 'object' && b.type === 'text')
    .map((b) => String(b.text ?? ''))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Fold one session log: its current title, its seed kind, and every human message in order. */
function scan(file) {
  return new Promise((resolve) => {
    const out = { title: null, seedKind: null, human: [] }
    const child = spawn('zstdcat', [file], { stdio: ['ignore', 'pipe', 'ignore'] })
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      // Most lines are huge injected documents; skip them before JSON.parse.
      if (!line.includes('"session/title"') && !line.includes('"user/message"')) return
      let event
      try { event = JSON.parse(line) } catch { return }
      const data = event.data ?? {}
      if (event.type === 'session/title') { out.title = data.title; return }
      const kind = data.source?.kind ?? '<none>'
      if (out.seedKind === null) out.seedKind = kind
      if (kind !== 'user') return
      const text = textOf(data.content)
      if (text.length > 0) out.human.push(text)
    })
    lines.on('close', () => resolve(out))
    child.on('error', () => resolve(out))
  })
}

/** A child session in the one shape the built reader touches. */
const asSession = (row) => ({
  deriveMessages: () => row.human.map((text) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })),
})

/** Classify a produced label so the corpus answers "useful or noise?". */
function klass(text) {
  if (text === undefined) return 'no label (keeps the title it was given)'
  if (text === '\u7ee7\u7eed') return 'noise: "继续"'
  if (text.startsWith('\u4ece\u4f1a\u8bdd session-')) return 'noise: handoff banner'
  if (text.startsWith('Current runtime context') || text.startsWith('memory ')
    || text.startsWith('handoff ') || text.startsWith('\u4e0a\u4e0b\u6587\u5df2\u7528')) return 'noise: injected status line'
  if (text.length <= 4) return 'noise: <=4 chars'
  return 'useful: a real instruction'
}

// 0. The probe judges nothing unless the functions it imported are the ones the plugin ships.
console.log('0. probe self-check (the imported readers behave)')
const banner = SCAFFOLDING.zh.continuationPrefix + '9f80b44-1c2d \u4ea4\u63a5\u3002\n<handoff>\n\u4e0a\u4e00\u4f1a\u8bdd\u4fe1\u606f\n</handoff>\n' + SCAFFOLDING.zh.continuationClosing
check('the fixture is a banner the shared predicate recognizes', isHandoffContinuationText(banner))
check('a banner-only continuation is named nothing', deferredHandoffLabel(asSession({ human: [banner] })) === undefined)
check('a real input names it', deferredHandoffLabel(asSession({ human: [banner, '\u6309\u6863 5 \u52a8\u624b'] })) === '\u6309\u6863 5 \u52a8\u624b')
check('a prefixed title yields its label', storedHandoffLabel(`${PRE}abcdef12`) === 'abcdef12')
check('a title the user chose yields nothing', storedHandoffLabel('\u7528\u6237\u81ea\u5df1\u8d77\u7684\u540d\u5b57') === undefined)
check('the prefix-less form the service can store is not adopted', storedHandoffLabel(PRE.trimEnd()) === undefined)

// Fold the corpus.
const sessions = new Map()
for (const name of readdirSync(STORE).filter((n) => n.startsWith('session-'))) {
  const base = join(STORE, name)
  const file = ['session.v4.jsonl.zstd', 'session.jsonl.zstd', 'session.v4.jsonl', 'session.jsonl']
    .map((f) => join(base, f)).find((f) => existsSync(f))
  sessions.set(name.slice('session-'.length), file === undefined ? { missing: true } : await scan(file))
}
const kids = [...sessions.entries()].filter(([, row]) => typeof row.title === 'string' && row.title.startsWith(PRE))
console.log('')
console.log(`sessions folded: ${sessions.size}   handoff children: ${kids.length}`)

// 1. The implemented rule over the real corpus.
console.log('')
console.log('1. what the implemented rule would write on the real corpus')
const named = new Map()
let namedCount = 0
let bannerFirst = 0
let bannerSkippedToLater = 0
let bannerBecameLabel = 0
let labelViolations = 0
for (const [, row] of kids) {
  const label = deferredHandoffLabel(asSession(row))
  named.set(klass(label), (named.get(klass(label)) ?? 0) + 1)
  if (label !== undefined) {
    namedCount += 1
    if (!/[^\p{Cc}\p{Cf}\s]/u.test(label) || label.length > LABEL_CHARS || /[\r\n]/u.test(label)) labelViolations += 1
  }
  // Pre-fix semantics, computed locally: the first `kind=user` message, banner or not.
  const first = row.human[0]
  if (first !== undefined && isHandoffContinuationText(first)) {
    bannerFirst += 1
    if (label === clipTitle(first, LABEL_CHARS)) bannerBecameLabel += 1
    if (label !== undefined && label !== clipTitle(first, LABEL_CHARS)) bannerSkippedToLater += 1
  }
}
console.log(`  ${String(namedCount).padStart(3)}  children the rule names`)
for (const [key, count] of [...named.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(3)}  ${key}`)
console.log('  example labels (child | label the rule would write):')
for (const [id, row] of kids.slice(-8)) console.log(`    ${id.slice(0, 8)} | ${String(deferredHandoffLabel(asSession(row))).slice(0, 52)}`)

check('every produced label has a visible character, one line, and fits the byte budget', labelViolations === 0, `${labelViolations} violation(s)`)

console.log('')
console.log('2. negative control: the banner filter, on the same corpus')
check('the corpus still exercises the class (a banner is some child\'s first kind=user message)', bannerFirst > 0, `${bannerFirst} such child(ren)`)
check('the corpus still exercises a banner that a later input follows', bannerSkippedToLater > 0, `${bannerSkippedToLater} such child(ren)`)
check('no banner ever becomes the label', bannerBecameLabel === 0, `${bannerBecameLabel} did`)

console.log('')
console.log('3. the prefix test the rewrite is gated on, over every folded session')
let prefixed = 0
let refused = 0
let misjudged = 0
for (const [, row] of sessions) {
  const owned = storedHandoffLabel(row.title) !== undefined
  const prefixedTitle = typeof row.title === 'string' && row.title.startsWith(PRE)
  if (owned !== prefixedTitle) misjudged += 1
  if (owned) prefixed += 1
  else refused += 1
}
console.log(`  ${String(prefixed).padStart(3)}  titles the rewrite may touch   ${String(refused).padStart(3)}  titles it must leave alone`)
check('a title is ours exactly when it carries the prefix', misjudged === 0, `${misjudged} misjudged`)

const failed = checks.filter((c) => !c.ok).length
console.log('')
console.log(`RESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed}/${checks.length} checks)`)
process.exit(failed === 0 ? 0 : 1)
