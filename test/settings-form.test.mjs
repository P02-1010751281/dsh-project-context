/**
 * Unit tests for the browser half's staged settings form.
 *
 * `client/settings-form.ts` is browser-side code that `pnpm test` never compiles
 * (the client tsconfig is `noEmit`, and `client/index.ts` pulls in React through
 * the card). It imports only types, so esbuild can bundle it standalone and the
 * suite can exercise the staged-edit rules — the code path that caused the
 * "stale draft pins the control" defect — without a browser.
 *
 * Run `pnpm test`, which builds `lib/` first and then runs `node --test`.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** Bundle the client module and import it through a data URL (no file is written). */
async function loadClientForm() {
	const result = await build({
		entryPoints: [fileURLToPath(new URL("../client/settings-form.ts", import.meta.url))],
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "es2022",
		write: false,
		logLevel: "warning",
	});
	const [output] = result.outputFiles ?? [];
	if (output === undefined) throw new Error("esbuild produced no output for client/settings-form.ts");
	return import(`data:text/javascript;base64,${Buffer.from(output.text, "utf8").toString("base64")}`);
}

/**
 * A settings scope that records writes, like the host-backed one the card binds:
 * the effective value is the composition base overlaid with the user layer and,
 * for this fake, with values a change elsewhere would have published.
 */
function fakeScope(initial) {
	let user = {};
	let foreign = {};
	const listeners = new Set();
	const effective = () => ({ ...initial, ...user, ...foreign });
	const publish = () => {
		for (const listener of listeners) listener();
	};
	return {
		scope: {
			getSnapshot: () => ({ status: "ready", value: effective(), base: { ...initial }, user, revision: 1, writable: true, mode: "host" }),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			set: async (field, next) => {
				user = { ...user, [field]: next };
				publish();
			},
			unset: async (field) => {
				const { [field]: _dropped, ...rest } = user;
				user = rest;
				publish();
			},
		},
		subscribeCount: () => listeners.size,
		/** What a change elsewhere (another tab, the host) would publish. */
		external: (next) => {
			foreign = { ...foreign, ...next };
			publish();
		},
	};
}

const { CardForm, booleanField, numberField, textField } = await loadClientForm();
const fields = [numberField("n", 1), textField("s"), booleanField("b")];

test("a draft equal to the effective value is not a staged edit", async () => {
	const harness = fakeScope({ n: 5, s: "x", b: true });
	const form = new CardForm(harness.scope, fields);

	form.actions().edit("n", "5"); // retyping the current value is not a pending edit
	assert.equal(form.shell().dirty, false, "an equal draft must not mark the card dirty");
	assert.equal(form.field("n").text, "5");

	// The defect: a retained equal draft pinned the control when the value moved
	// elsewhere, with nothing to save and a disabled Discard button.
	harness.external({ n: 7 });
	assert.equal(form.field("n").text, "7", "the control follows the effective value, not a stale draft");
	assert.equal(form.shell().dirty, false);
});

test("staged edits plan, save and discard like the card expects", async () => {
	const harness = fakeScope({ n: 5, s: "x", b: true });
	const form = new CardForm(harness.scope, fields);

	form.actions().edit("n", "9");
	form.actions().edit("s", "");
	assert.equal(form.shell().dirty, true);
	assert.equal(form.shell().invalid, false);
	assert.equal(form.field("n").text, "9", "a genuinely staged draft wins over the effective value");
	assert.equal(form.field("n").overridden, true);

	await form.save();
	assert.equal(form.shell().dirty, false, "saving clears the staged edits");
	assert.equal(harness.scope.getSnapshot().value.n, 9);
	assert.equal(harness.scope.getSnapshot().value.s, "x", "an empty draft is a clear of the user layer, not of the value");

	form.actions().edit("n", "abc");
	assert.equal(form.shell().invalid, true, "an unparseable draft blocks the save");
	form.actions().discard();
	assert.equal(form.shell().invalid, false);
	assert.equal(form.field("n").text, "9", "discard restores the effective value");
});

test("resetField stages an inherit and dispose releases the scope subscription", async () => {
	const harness = fakeScope({ n: 5, s: "x", b: true });
	const form = new CardForm(harness.scope, fields);
	assert.equal(harness.subscribeCount(), 1, "the form subscribes to its scope");

	form.actions().edit("n", "9");
	await form.save();
	form.actions().resetField("n");
	assert.equal(form.field("n").overridden, false, "a reset is not a user-layer value");
	assert.equal(form.shell().dirty, true, "the reset itself is pending until saved");

	await form.save();
	assert.equal(harness.scope.getSnapshot().user.n, undefined, "the user layer entry is removed");
	assert.equal(form.shell().dirty, false);

	form.dispose();
	assert.equal(harness.subscribeCount(), 0, "dispose releases the subscription");
	form.dispose(); // idempotent
	assert.equal(harness.subscribeCount(), 0);
});

test("every settings key has a card spec, a projection and a rendered row", async () => {
	// Comments are stripped first: a commented-out spec or row must not satisfy a text scan.
	const source = (await readFile(fileURLToPath(new URL("../client/settings-card.tsx", import.meta.url)), "utf8"))
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
	const { PluginSettingsSchema } = await import("../lib/shared/settings.js");
	const keys = Object.keys(PluginSettingsSchema({}));
	assert.ok(keys.length > 0);
	for (const key of keys) {
		const id = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		assert.match(source, new RegExp(`\\w+Field\\("${id}"`), `${key} must be in the card's spec list`);
		assert.ok(source.includes(`this.form.field("${key}")`), `${key} must be projected into the card state`);
		// The rendered row must bind the same key three times — its locale key, the state slot it
		// reads and the field name it writes — so a copy-pasted row cannot render someone else's value.
		const row = new RegExp(`\\{field\\(\\s*"[^"]*",\\s*"field\\.${id}",\\s*"field\\.${id}Hint",\\s*"[a-z]+",\\s*state\\.${id},\\s*"${id}"[^)]*\\)\\}`);
		assert.match(source, row, `${key} must have a rendered row bound to its own state and locale key`);
	}
});
