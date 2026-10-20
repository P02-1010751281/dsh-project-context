#!/usr/bin/env node
/**
 * Does the 0.2.1 line interpolate our injected documents by default, and does `interpolate: false`
 * actually stop it *on the context path we use*?
 *
 * Why: dsh 0.2.x added prompt-variable interpolation to `systemPrompt.context`. Both of our looked-up
 * documents are prose files, so a literal `{{...}}` in MEMORY.md/CONTEXT.md becomes a variable
 * reference; a malformed one throws and fails the whole turn before the model is called. Commit
 * 6109688 opts both registrations out, but the pinned 0.1.7 types predate the flag, so the claim has
 * to be checked against the *host's own* renderer rather than our types.
 *
 * Read-only: imports the host's built module, writes nothing. The store path is an argument because
 * hashes rotate on every rebuild.
 *
 * Usage: node interpolate-probe.mjs <dsh-desktop-store-path>
 * Exit:  0 = all four claims hold   1 = a claim failed   2 = indeterminate (no importable build)
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const store = process.argv[2]
if (!store) {
	console.error('usage: node interpolate-probe.mjs <dsh-desktop-store-path>')
	process.exit(2)
}

const candidates = [
	// What the running host actually resolves (the nix-project copy is named after the store).
	join(homedir(), '.dsh/desktop/nix-project', basename(store), 'node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'),
	// What the nix build produced for the same store (read-only tree).
	join(store, 'lib/dsh-desktop/repo/packages/core/system-prompt/lib/index.js'),
]
const modulePath = candidates.find((p) => existsSync(p))
if (!modulePath) {
	console.error(`no importable dsh-system-prompt build for ${store}`)
	process.exit(2)
}

const { renderContextSections } = await import(pathToFileURL(modulePath).href)
const repo = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '')
/** `--lib=<path>`: point D at another build, so the claim can be shown failing (see the README). */
const libArg = process.argv.find((a) => a.startsWith('--lib='))
const builtPath = libArg ? libArg.slice('--lib='.length) : join(repo, 'lib/project-memory/index.js')
const built = readFileSync(builtPath, 'utf8')

const failures = []
const check = (name, ok, detail) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
	if (!ok) failures.push(name)
}

console.log(`host module   ${modulePath}`)
console.log(`built plugin  ${builtPath}`)
console.log('')

/** Render one context contribution through the host's own context renderer. */
const render = (context) => renderContextSections({ contexts: [context], variables: { name: 'INTERPOLATED' } })

// A. Default is interpolate-on: a well-formed reference in prose is substituted.
const a = (() => {
	try {
		return render({ name: 'probe', text: 'handlebars: {{name}}' })[0]?.text ?? ''
	} catch (error) {
		return `threw: ${error.message}`
	}
})()
check('A. default context interpolates `{{name}}`', a === 'handlebars: INTERPOLATED', a)

// B. The hazard: one malformed reference fails the whole render, which is what kills a turn.
const b = (() => {
	try {
		return `no throw: ${render({ name: 'probe', text: 'documented as {{ model }}' })[0]?.text ?? ''}`
	} catch (error) {
		return error.message
	}
})()
check('B. a spaced `{{ model }}` throws on the default path', /malformed prompt variable reference/.test(b), b.slice(0, 120))

// C. The fix's claim, on the exact path our injections take.
const c = (() => {
	try {
		return render({ name: 'probe', text: 'documented as {{ model }}', interpolate: false })[0]?.text ?? ''
	} catch (error) {
		return `threw: ${error.message}`
	}
})()
check('C. `interpolate: false` preserves the text verbatim', c === 'documented as {{ model }}', c)

// D. Our built plugin opts both documents out (source claims are not shipping claims).
const flags = [...built.matchAll(/interpolate:\s*(true|false)/g)].map((m) => m[1])
check('D. built lib carries `interpolate: false` twice', flags.length === 2 && flags.every((f) => f === 'false'), `found ${JSON.stringify(flags)}`)

console.log('')
if (failures.length > 0) {
	console.log(`RESULT: FAIL (${failures.length} claim(s): ${failures.join('; ')})`)
	process.exit(1)
}
console.log('RESULT: PASS (default interpolation is on for contexts, a malformed reference throws, and both of our documents opt out)')
