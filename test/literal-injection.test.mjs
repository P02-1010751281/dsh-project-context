/**
 * The two injected documents are prose, not prompt templates: they must be registered as literal text.
 *
 * dsh 0.2.x interpolates each `systemPrompt.context` contribution by default
 * (`renderContextSections` → `interpolate`, `packages/core/system-prompt/src/index.ts`). A *malformed*
 * reference anywhere in MEMORY.md or CONTEXT.md — the real hazard is a doc that documents a
 * placeholder, e.g. ``documented as {{ model }}`` — then throws `malformed prompt variable reference`
 * while the prompt is assembled, which fails the whole turn before the model is called. The fix
 * (6109688) is `interpolate: false` on both registrations.
 *
 * That fix is easy to lose silently, because it is not part of the type this repo builds against
 * (`@deepseek-ai/dsh-system-prompt@0.1.7-rc.2` predates the flag), so the registration is widened
 * locally and a later devDependency bump could make the flag look redundant and drop it. The
 * behavioural half is pinned by
 * `.agents/evidence/2026-10-20-dsh-021rc2-api-compat/interpolate-probe.mjs`, which renders a `{{…}}`
 * through the host's own renderer; this case pins our side of the contract.
 *
 * The positive control matters here: a stub that captured *nothing* would also satisfy a naive
 * "no registration is interpolated", so the case first asserts which two sections were registered.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { apply as applyMemory } from "../lib/project-memory/index.js";
import { resolvePluginConfig } from "../lib/shared/config.js";

/** Apply the memory plugin to a minimal host whose `systemPrompt.context` records its registrations. */
function registrations() {
	const seen = [];
	applyMemory(
		{
			logger: { info() {}, warn() {} },
			systemPrompt: {
				context: (registration) => {
					seen.push(registration);
				},
			},
			on: () => () => undefined,
			commands: { register: () => undefined },
		},
		resolvePluginConfig({}),
	);
	return seen;
}

test("both injected documents opt out of prompt interpolation", () => {
	const seen = registrations();
	assert.deepEqual(
		seen.map((registration) => registration.name),
		["project-memory", "project-context"],
		"control: the plugin registers exactly these two context sections",
	);
	for (const registration of seen) {
		assert.equal(
			registration.interpolate,
			false,
			`${registration.name} is prose: a literal {{…}} inside it must reach the model as written instead of failing the turn`,
		);
	}
});
