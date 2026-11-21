/**
 * Pre-restart preflight: render the shipped settings card twice — once against the platform bundle
 * this repo compiles against (0.1.7-rc.2 devDependency) and once against the platform bundle the
 * RUNNING host will actually supply (dsh-desktop 0.2.2-rc.3 store checkout) — and compare the
 * structural fingerprint of the markup.
 *
 * Why: the card lives in lib/client.js and is materialized by the Shell's own module system against
 * the host's ui-primitives, not the devDependency. A prop or component rename between those two
 * versions would only show up after a restart, as a blank or broken settings page.
 *
 * Usage: node probe.mjs [<live ui-primitives/lib/index.js>] [--control]
 * Exit 0 = both renders agree, 1 = they disagree, 2 = a render threw.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "/mnt/Data/Projects/dsh-project-context";
/** The platform bundle the running host supplies; pass another path when that host upgrades. */
const DEFAULT_STORE = "/nix/store/xbbn6inj2q64j88gsmjrljqkh1m572sy-dsh-desktop-0.2.2-rc.3/lib/dsh-desktop/repo/packages/client/ui-primitives/lib/index.js";
const STORE = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) ?? DEFAULT_STORE;
const require = createRequire(join(REPO, "package.json"));
const { build } = require("esbuild");
const PINNED = require.resolve("@deepseek-ai/dsh-client-ui-primitives/package.json").replace(/package\.json$/, "lib/index.js");
const CONTROL = process.argv.includes("--control");

/** Every name a platform bundle binds from a bare specifier, so an unresolvable dep can be stubbed exactly. */
function boundNames(source) {
	const names = new Map();
	const add = (spec, name) => {
		if (!names.has(spec)) names.set(spec, new Set());
		names.get(spec).add(name);
	};
	for (const m of source.matchAll(/(?:import|export)\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)"/g)) {
		if (m[2].startsWith(".") || m[2].startsWith("/")) continue;
		for (const binding of m[1].split(",")) {
			const imported = binding.trim().split(/\s+as\s+/)[0].trim();
			if (/^[A-Za-z_$][\w$]*$/.test(imported)) add(m[2], imported);
		}
	}
	for (const m of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[\s\S]*?\})?\s*from\s*"([^"]+)"/g)) {
		if (m[2].startsWith(".") || m[2].startsWith("/")) continue;
		add(m[2], "default");
	}
	return names;
}

const PASSTHROUGH = [
	"const passthrough = new Proxy(function () {}, {",
	"\tget: (_t, key) => {",
	'\t\tif (key === Symbol.toPrimitive) return () => "stub";',
	'\t\tif (key === "then" || typeof key === "symbol") return undefined;',
	"\t\treturn passthrough;",
	"\t},",
	"\tapply: () => passthrough,",
	"\tconstruct: () => passthrough,",
	"});",
].join("\n");

const VALUE = {
	archiveEnabled: true, memoryEnabled: true, consolidateTurns: 12, consolidateIntervalMs: 600000,
	forceDedupeMs: 60000, maxTokens: 4096, maxOutputTokens: 8192, maxMemoryChars: 32000,
	provider: "deepseek", model: "deepseek-chat", autolearnEnabled: true, autolearnTurns: 12,
	autolearnIntervalMs: 600000, handoffEnabled: true, handoffThreshold: "0.8",
	handoffBudgetSummaryTokens: 64000, handoffBudgetRecentTokens: 20000, handoffPendingQuestion: "defer",
	handoffLang: "auto", autolearnExpireSkills: true, sessionSettledDays: 7, taskMode: "assisted",
	handoffRetireReplaced: true,
};

/** Build the card against one platform index and render it; returns the static markup. */
async function renderAgainst(indexPath) {
	const source = readFileSync(indexPath, "utf8");
	const names = boundNames(source);
	const stubbed = [];
	const plugins = [{
		name: "platform",
		setup(pluginBuild) {
			pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
				if (args.path === "@deepseek-ai/dsh-client-ui-primitives") return { path: indexPath };
				if (args.path.startsWith("node:")) return undefined;
				// The store's own node_modules would hand the card a second React (null dispatcher);
				// pin the whole family to this repo's copy so both builds share one dispatcher.
				if (/^react(?:-dom)?(?:\/|$)/.test(args.path)) return { path: require.resolve(args.path) };
				try {
					require.resolve(args.path);
					return undefined;
				} catch {
					stubbed.push(args.path);
					return { path: args.path, namespace: "stub" };
				}
			});
			pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
				const bound = names.get(args.path) ?? new Set();
				const lines = [PASSTHROUGH];
				if (bound.has("default") || bound.size === 0) lines.push("export default passthrough;");
				for (const name of bound) if (name !== "default") lines.push(`export const ${name} = passthrough;`);
				return { contents: lines.join("\n"), loader: "js" };
			});
		},
	}, {
		name: "assets",
		setup(pluginBuild) {
			pluginBuild.onResolve({ filter: /\.(css|svg|png|woff2?)$/ }, (args) => ({ path: args.path, namespace: "asset" }));
			pluginBuild.onLoad({ filter: /.*/, namespace: "asset" }, () => ({
				contents: 'export default new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) })',
				loader: "js",
			}));
		},
	}];

	const result = await build({
		stdin: {
			contents: [
				'export { createElement } from "react";',
				'export { renderToStaticMarkup } from "react-dom/server";',
				'export { ProjectContextSettingsCard, ProjectContextSettingsCardController } from "./client/settings-card.tsx";',
			].join("\n"),
			resolveDir: REPO,
			loader: "tsx",
			sourcefile: "probe-entry.tsx",
		},
		bundle: true,
		format: "esm",
		platform: "node",
		target: "es2022",
		jsx: "automatic",
		write: false,
		logLevel: "error",
		nodePaths: [join(REPO, "node_modules")],
		banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
		plugins,
	});

	const [output] = result.outputFiles ?? [];
	if (!output) throw new Error("esbuild produced no bundle");
	const dir = mkdtempSync(join(tmpdir(), "live-card-"));
	const bundlePath = join(dir, "card.mjs");
	writeFileSync(bundlePath, output.text);

	const { createElement, renderToStaticMarkup, ProjectContextSettingsCard, ProjectContextSettingsCardController } =
		await import(pathToFileURL(bundlePath).href);

	let calls = 0;
	const scope = {
		getSnapshot: () => ({ status: "ready", value: VALUE, base: {}, user: {}, writable: true, revision: 7 }),
		subscribe: () => () => {},
		mutate: async () => { calls += 1; return true; },
	};
	const controller = new ProjectContextSettingsCardController(scope);
	const face = controller.inject();
	const store = face.hooks.projectContextSettingsCard;
	const props = {
		...face,
		view: "page",
		t: (key) => key,
		useProjectContextSettingsCard: (select) => select(store.getSnapshot()),
	};
	const t0 = Date.now();
	const html = renderToStaticMarkup(createElement(ProjectContextSettingsCard, { ...props, view: "page" }));
	return { html, stubbed: [...new Set(stubbed)].sort(), calls, ms: Date.now() - t0 };
}

/** What a user sees: which tabs/panels/fields exist, how many of each control, which panel is shown. */
function fingerprint(html) {
	const ids = (re) => [...html.matchAll(re)].map((m) => m[1]).sort();
	return {
		tabs: ids(/id="dsh-pc-tab-([a-z]+)"/g),
		panels: ids(/id="dsh-pc-panel-([a-z]+)"/g),
		fields: [...new Set(ids(/id="dsh-pc-([a-zA-Z]+)"/g))],
		visiblePanels: [...html.matchAll(/<section[^>]*role="tabpanel"[^>]*>/g)].filter((m) => !/\bhidden\b/.test(m[0])).length,
		buttons: (html.match(/<button/g) ?? []).length,
		switches: (html.match(/role="switch"/g) ?? []).length,
		tablists: (html.match(/role="tablist"/g) ?? []).length,
		rows: (html.match(/class="dshPcRow"/g) ?? []).length,
		bytes: html.length,
		digest: createHash("sha256").update(html).digest("hex").slice(0, 16),
	};
}

const live = await renderAgainst(STORE);
const pinned = await renderAgainst(PINNED);
const livePrint = fingerprint(live.html);
const pinnedPrint = fingerprint(pinned.html);

// Control: mutate one fingerprint so the comparison itself is shown to be able to fail.
if (CONTROL) pinnedPrint.fields = pinnedPrint.fields.slice(1);

// Bytes and the raw digest are expected to move when the platform's own tab chrome changes
// (`data-size`, an inset-aware translate); every structural key must match.
const CHROME_ONLY = new Set(["bytes", "digest"]);
const differing = Object.keys(livePrint).filter((key) => !CHROME_ONLY.has(key) && JSON.stringify(livePrint[key]) !== JSON.stringify(pinnedPrint[key]));
console.log(JSON.stringify({
	pinned: { platform: PINNED, ...pinnedPrint },
	live: { platform: STORE, ...livePrint },
	differing,
	chromeOnlyDelta: { bytes: livePrint.bytes - pinnedPrint.bytes, digest: livePrint.digest === pinnedPrint.digest },
	markupEqual: live.html === pinned.html,
	control: CONTROL,
	stubbedByLive: live.stubbed.length,
	pass: !CONTROL && differing.length === 0 && livePrint.tablists === 1 && livePrint.visiblePanels === 1 && livePrint.tabs.length === livePrint.panels.length && livePrint.tabs.length > 0,
}, null, 2));
process.exit(!CONTROL && differing.length === 0 ? 0 : 1);
