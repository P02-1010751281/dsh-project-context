// Read-only probe: how good would each candidate source for a handoff child's title be?
//
// It folds every archived session of THIS workspace (the one this repo lives in):
//   - the title (last `session/title` event) -> tells us which sessions are handoff children
//   - every human turn (`user/message` with `source.kind === "user"`)
// then  answers, over the real corpus:
//   * candidate 1/3 (eager): parent session's LAST human input would become the child's label
//   * candidate 4/5 (deferred): the child's own FIRST human input would become the label
//
// Run:  node .agents/evidence/2026-10-07-handoff-title-label-survey/survey.mjs
// No writes, no network. `zstdcat` must be on PATH; the store is read-only input.
import { readdirSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** `↪ handoff · ` — the literal in `src/project-handoff/marker.ts`. */
const PRE = '\u21aa handoff \u00b7 '
/** Workspace store directory; the id shape is `--<cwd with / -> ->`--`. */
const STORE = join(homedir(), '.dsh/sessions/--mnt-Data-Projects-dsh-project-context--')

/** Concatenate the text parts of one message, collapsed to a single line. */
function textOf(data) {
  return (data.content ?? [])
    .filter((part) => part !== null && typeof part === 'object' && part.type === 'text')
    .map((part) => String(part.text ?? ''))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Fold one session log: title plus the human turns. */
function scan(file) {
  return new Promise((resolve) => {
    const out = {
      title: null, seedKind: null, humanCount: 0, humanFirst: null, humanLast: null,
    }
    const child = spawn('zstdcat', [file], { stdio: ['ignore', 'pipe', 'ignore'] })
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      // Most lines are huge tool/runtime-context payloads; skip them before JSON.parse.
      if (!line.includes('"session/title"') && !line.includes('"user/message"')) return
      let event
      try { event = JSON.parse(line) } catch { return }
      const data = event.data ?? {}
      if (event.type === 'session/title') { out.title = data.title; return }
      const kind = data.source?.kind ?? '<none>'
      if (out.seedKind === null) out.seedKind = kind
      if (kind !== 'user') return
      const text = textOf(data)
      if (text.length === 0) return
      out.humanCount += 1
      if (out.humanFirst === null) out.humanFirst = text
      out.humanLast = text
    })
    lines.on('close', () => resolve(out))
    child.on('error', () => resolve(out))
  })
}

/** Classify a would-be label so the corpus answers "useful or noise?". */
function klass(text) {
  if (text === null) return 'no-source (falls back to the parent id)'
  if (text === '\u7ee7\u7eed') return 'noise: "继续"'
  if (text.startsWith('\u4ece\u4f1a\u8bdd session-')) return 'noise: handoff banner'
  if (text.startsWith('Current runtime context') || text.startsWith('memory ')
    || text.startsWith('handoff ') || text.startsWith('\u4e0a\u4e0b\u6587\u5df2\u7528')) return 'noise: injected status line'
  if (text.length <= 4) return 'noise: <=4 chars'
  return 'useful: a real instruction'
}

const sessions = new Map()
for (const name of readdirSync(STORE).filter((n) => n.startsWith('session-'))) {
  const base = join(STORE, name)
  const file = ['session.v4.jsonl.zstd', 'session.jsonl.zstd', 'session.v4.jsonl', 'session.jsonl']
    .map((f) => join(base, f)).find((f) => existsSync(f))
  sessions.set(name.slice('session-'.length), file === undefined ? { missing: true } : await scan(file))
}
const parentOf = (label) => {
  for (const [id, row] of sessions) if (id.startsWith(label)) return row
  return undefined
}
const kids = [...sessions.entries()].filter(([, row]) => typeof row.title === 'string' && row.title.startsWith(PRE))
const label = (row) => (row === undefined || row.missing ? null : row.humanLast ?? null)

console.log(`sessions folded: ${sessions.size}   handoff children: ${kids.length}`)
console.log('')

console.log('candidate 1/3 - eager label from the PARENT session\'s last human input:')
const eager = new Map()
for (const [, row] of kids) {
  const parent = parentOf(row.title.slice(PRE.length).trim())
  const key = klass(label(parent))
  eager.set(key, (eager.get(key) ?? 0) + 1)
}
for (const [key, count] of [...eager.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(3)}  ${key}`)

console.log('')
console.log('candidate 4/5 - deferred label from the CHILD session\'s own first human input:')
const withOwn = kids.filter(([, row]) => row.humanCount > 0)
console.log(`  ${String(withOwn.length).padStart(3)}  children have at least one human turn -> label available`)
console.log(`  ${String(kids.length - withOwn.length).padStart(3)}  never typed in (same as today: the parent id stays)`)
const bannerFirst = withOwn.filter(([, row]) => String(row.humanFirst ?? '').startsWith('\u4ece\u4f1a\u8bdd session-'))
console.log(`  ${String(bannerFirst.length).padStart(3)}  of those have an OLD handoff banner as their first kind=user message`)
console.log(`        (pre-fix seeding wrote the seed as kind=user; current seeds are kind=dsh-project-context,`)
console.log(`         so a source.kind==="user" trigger cannot mistake a fresh seed for a human turn)`)
const kinds = new Map()
for (const [, row] of kids) kinds.set(row.seedKind, (kinds.get(row.seedKind) ?? 0) + 1)
console.log(`  seed source.kind across children: ${JSON.stringify([...kinds.entries()])}`)

console.log('')
console.log('example eager labels (child | parent | parent.lastHuman):')
for (const [id, row] of kids.slice(-12)) {
  const parent = parentOf(row.title.slice(PRE.length).trim())
  const text = label(parent)
  console.log(`  ${id.slice(0, 8)} | ${row.title.slice(PRE.length).trim()} | ${text === null ? '<no human message>' : text.slice(0, 46)}`)
}
