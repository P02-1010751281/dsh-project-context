#!/usr/bin/env node
/**
 * Acceptance probe for the deferred continuation retitle (`src/project-handoff/relabel.ts`).
 *
 * The claim under test: a handoff continuation that receives its **first** human input *after* the
 * plugin was loaded gets a **second** `session/title` event, whose title is the same
 * `HANDOFF_TITLE_PREFIX` plus the first input's clipped label.
 *
 * What makes this observable, and why the child's own log is the whole evidence: the write is one
 * `session/title` with `source.kind:"user"`, which the title service then pins ("A user rename pins
 * the title"), so the event count inside that one session file is the entire surface. `relabel.ts`
 * decides the write on the event that carried the first naming input (`firstHandoffInput(...).seq`),
 * so the **input's own time** — not the child's creation time, and not a file mtime, which moves on
 * republish — is what scopes the search.
 *
 * Nothing offline can produce it. The offline probe next door
 * (`.agents/evidence/2026-10-07-handoff-relabel-reentry/probe.mjs`) only proves a real `SessionStore`
 * accepts the deferred write; it cannot prove the running host calls the code.
 *
 * The prefix and the label are read from the built `lib/` — the code the host actually loads — so the
 * probe cannot judge a string the artifact does not write.
 *
 * Tri-state on purpose (a green that proves nothing is the failure mode to avoid):
 *   0  PASS        every continuation talked to since the holder started carries two title events
 *   1  FAIL        a continuation whose first input landed after the holder started still carries one
 *   2  UNOBSERVABLE the load criterion is negative, or no continuation has been talked to yet
 *
 * Both FAIL and UNOBSERVABLE are reachable and are exercised by `--selftest`.
 *
 * Run:  node .agents/evidence/2026-10-07-handoff-retitle-accept/retitle-accept.mjs
 *       node .agents/evidence/2026-10-07-handoff-retitle-accept/retitle-accept.mjs --selftest
 *
 * Env overrides (used by `--selftest`, also handy against a copied store):
 *   SESSIONS_ROOT, HOLDER_START (unix seconds), SRC_COMMIT_TIME (unix seconds)
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

const { HANDOFF_TITLE_PREFIX } = await import(pathToFileURL(join(ROOT, "lib/project-handoff/marker.js")).href);
const { firstHandoffInput } = await import(pathToFileURL(join(ROOT, "lib/project-handoff/conversation.js")).href);

const iso = (seconds) => (seconds > 0 ? new Date(seconds * 1000).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 19) : "?");

/** The process that serves this GUI, and its start time. pid 0 / start 0 when it cannot be read. */
function socketHolder() {
	let out = "";
	try {
		out = execFileSync("ss", ["-ltnp"], { encoding: "utf8" });
	} catch {
		return { pid: 0, start: 0 };
	}
	const line = out.split("\n").find((row) => row.includes("127.0.0.1:19387"));
	const pid = Number((line?.match(/pid=(\d+)/) ?? [])[1] ?? 0);
	if (!pid) return { pid: 0, start: 0 };
	let etimes = 0;
	try {
		etimes = Number(execFileSync("ps", ["-o", "etimes=", "-p", String(pid)], { encoding: "utf8" }).trim());
	} catch {
		return { pid, start: 0 };
	}
	if (!Number.isFinite(etimes) || etimes <= 0) return { pid, start: 0 };
	return { pid, start: Math.floor(Date.now() / 1000) - etimes };
}

/** Last `src/` commit, in unix seconds. */
function srcCommitTime() {
	try {
		return Number(execFileSync("git", ["log", "-1", "--format=%ct", "--", "src/"], { cwd: ROOT, encoding: "utf8" }).trim());
	} catch {
		return 0;
	}
}

/** Every session directory under a workspace root, with the one live log file of each. */
function sessionDirs(root) {
	const found = [];
	let workspaces;
	try {
		workspaces = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
	} catch {
		return found;
	}
	for (const workspace of workspaces) {
		const ws = join(root, workspace.name);
		let entries;
		try {
			entries = readdirSync(ws, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || !entry.name.startsWith("session-")) continue;
			const dir = join(ws, entry.name);
			// Highest version wins: a session republished to v4 keeps its older `session.vN` beside the
			// new file, and concatenating the two would double-count every title event in it.
			const files = readdirSync(dir)
				.filter((name) => /^session.*\.jsonl(\.zstd)?$/.test(name))
				.sort();
			const file = files.at(-1);
			if (file) found.push({ id: entry.name.replace(/^session-/, "").slice(0, 8), file: join(dir, file) });
		}
	}
	return found;
}

function eventsOf(file) {
	const text = file.endsWith(".zstd")
		? execFileSync("zstdcat", [file], { encoding: "utf8", maxBuffer: 1 << 30 })
		: readFileSync(file, "utf8");
	const events = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		try {
			events.push(JSON.parse(line));
		} catch {
			// A truncated tail line is not this probe's subject.
		}
	}
	return events;
}

/**
 * One session's verdict. `skip` rows are the non-discriminating majority (an ordinary session, a
 * continuation nobody has typed into, a first input older than the holder) and must never be a FAIL:
 * a wrong cause is worse than no verdict.
 */
export function classify(events, holderStart) {
	const titles = events.filter((e) => e.type === "session/title");
	if (titles.length === 0) return { kind: "skip", why: "no session/title" };
	const first = titles[0]?.data?.title;
	if (typeof first !== "string" || !first.startsWith(HANDOFF_TITLE_PREFIX)) {
		return { kind: "skip", why: "not a continuation title" };
	}
	const stored = first.slice(HANDOFF_TITLE_PREFIX.length);
	const input = firstHandoffInput({ snapshotEvents: () => events });
	if (input === undefined) return { kind: "skip", why: "nobody has typed into it yet" };
	const at = Math.floor((events.find((e) => e.seq === input.seq)?.time ?? 0) / 1000);
	if (!(at > holderStart)) return { kind: "skip", why: `first human input predates the holder (${iso(at)})` };
	// `relabel.ts` returns early when the label it would write is already the stored one, so a single
	// title event is the correct outcome here and must not read as a missing write.
	if (input.label === stored) return { kind: "skip", why: "the label equals the stored title, so no write is expected" };
	const last = titles.at(-1)?.data?.title;
	if (titles.length >= 2 && typeof last === "string" && last.startsWith(HANDOFF_TITLE_PREFIX) && last !== first) {
		return { kind: "pass", stored, label: input.label, last, at };
	}
	return { kind: "fail", stored, label: input.label, at, count: titles.length, last };
}

function main({ sessionsRoot, holderStart, srcTime }) {
	const loaded = holderStart > 0 && srcTime > 0 && holderStart > srcTime;
	console.log("== inputs ==");
	console.log(`  sessions root  ${sessionsRoot}`);
	console.log(`  prefix         "${HANDOFF_TITLE_PREFIX}" (read from lib/project-handoff/marker.js)`);
	console.log(`  holder         ${holderStart > 0 ? `started ${iso(holderStart)}` : "unknown"}`);
	console.log(`  src/           ${srcTime > 0 ? `committed ${iso(srcTime)}` : "unknown"}`);
	console.log(`  criterion      ${loaded ? "POSITIVE — the holder is later than the last src/ commit" : "NEGATIVE — the holder predates the last src/ commit, so a missing retitle cannot discriminate"}`);

	const rows = [];
	let scanned = 0;
	let continuations = 0;
	for (const { id, file } of sessionDirs(sessionsRoot)) {
		scanned += 1;
		let events;
		try {
			events = eventsOf(file);
		} catch (error) {
			rows.push({ id, verdict: { kind: "skip", why: `unreadable: ${error.message}` } });
			continue;
		}
		const verdict = classify(events, holderStart);
		if (verdict.kind !== "skip") continuations += 1;
		rows.push({ id, verdict });
	}

	const passes = rows.filter((r) => r.verdict.kind === "pass");
	// With a negative criterion a single-title continuation is exactly what the old code writes, so it
	// is a note, never a FAIL: the cause would be named wrongly.
	const fails = rows.filter((r) => r.verdict.kind === "fail");
	console.log("== continuations whose first human input landed after the holder started ==");
	for (const { id, verdict } of rows) {
		if (verdict.kind === "pass") {
			console.log(`  PASS  ${id}  titled "${verdict.stored}" now "${verdict.last}"  (input ${iso(verdict.at)})`);
		} else if (verdict.kind === "fail" && loaded) {
			console.log(`  FAIL  ${id}  still "${verdict.stored}" after input ${iso(verdict.at)} — first human input "${verdict.label}", title events ${verdict.count}`);
		} else if (verdict.kind === "fail") {
			console.log(`  ..    ${id}  still "${verdict.stored}" after input ${iso(verdict.at)} — expected while the holder predates the last src/ commit`);
		}
	}
	if (passes.length === 0 && (fails.length === 0 || !loaded)) console.log("  (none judging)");
	console.log(`  scanned ${scanned} session dir(s); ${continuations} continuation(s) received their first human input after the holder started`);
	if (passes.length > 0 && fails.length === 0 && loaded) {
		console.log(`\nRESULT: PASS — ${passes.length} continuation(s) re-titled after their own first input.`);
		return 0;
	}
	if (!loaded) {
		console.log("\nRESULT: UNOBSERVABLE — criterion negative; restart first, then type into a continuation that has never been typed into.");
		return 2;
	}
	if (fails.length > 0) {
		console.log(`\nRESULT: FAIL — ${fails.length} continuation(s) keep a single title event although their first input landed after the holder started; the deferred retitle is not live.`);
		return 1;
	}
	console.log("\nRESULT: UNOBSERVABLE — the holder is current but no continuation has received its first human input since it started. Type one sentence into a `↪ handoff · …` session that has never been typed into, then re-run.");
	return 2;
}

function fixture(root, name, events) {
	const dir = join(root, "--fixture--", `session-${name}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "session.v4.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function uuid(seed) {
	const hex = seed.padEnd(32, "0").slice(0, 32);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function selftest() {
	const T = 1_800_000_000;
	const titleEvent = (seq, time, title) => ({ type: "session/title", seq, time, data: { title, messageSeqs: [], source: { kind: "user" } } });
	const human = (seq, time, text) => ({ type: "user/message", seq, time, data: { source: { kind: "user" }, content: [{ type: "text", text }] } });
	const header = (id) => ({ type: "session", version: 4, id: `session-${uuid(id)}` });
	const seeded = (id) => [header(id), titleEvent(1, (T - 900) * 1000, `${HANDOFF_TITLE_PREFIX}bbbbbbbb`), human(5, (T + 500) * 1000, "hello world")];
	const cases = [
		// The FAIL branch: a continuation talked to after the holder started, still one title event.
		{ name: "failing", holder: T, src: T - 100, expect: 1, events: seeded },
		// The PASS branch: the same child, plus the `session/title` the deferred retitle writes.
		{ name: "passing", holder: T, src: T - 100, expect: 0, events: (id) => [...seeded(id), titleEvent(6, (T + 501) * 1000, `${HANDOFF_TITLE_PREFIX}hello world`)] },
		// The UNOBSERVABLE branch, and the one that must never be a FAIL: same child, but the holder
		// predates the last src/ commit, so a single title event is exactly what the old code writes.
		{ name: "negative", holder: T - 1000, src: T, expect: 2, events: seeded },
		// Nothing typed into the continuation yet: also unobservable, never a FAIL.
		{ name: "untouched", holder: T, src: T - 100, expect: 2, events: (id) => [header(id), titleEvent(1, (T - 900) * 1000, `${HANDOFF_TITLE_PREFIX}bbbbbbbb`)] },
		// Negative control: an ordinary session carries no prefix and is never judged.
		{ name: "ordinary", holder: T, src: T - 100, expect: 2, events: (id) => [header(id), titleEvent(1, (T - 900) * 1000, "s审查维护"), human(5, (T + 500) * 1000, "hello")] },
	];
	let bad = 0;
	for (const { name, holder, src, expect, events } of cases) {
		const root = mkdtempSync(join(tmpdir(), "retitle-accept-"));
		try {
			const id = name.replace(/[^a-z]/g, "").padEnd(8, "0").slice(0, 8);
			fixture(root, uuid(id), events(id));
			console.log(`-- selftest case ${name}`);
			const code = main({ sessionsRoot: root, holderStart: holder, srcTime: src });
			const ok = code === expect;
			console.log(`  ${ok ? "PASS" : "FAIL"}  selftest ${name}: exit ${code}, expected ${expect}`);
			if (!ok) bad += 1;
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
	console.log(bad === 0 ? "\nSELFTEST: PASS — FAIL, PASS and UNOBSERVABLE are all reachable" : "\nSELFTEST: FAIL");
	return bad === 0 ? 0 : 1;
}

if (process.argv.includes("--selftest")) {
	process.exit(selftest());
} else {
	const env = process.env;
	const holder = env.HOLDER_START ? Number(env.HOLDER_START) : socketHolder();
	process.exit(main({
		sessionsRoot: env.SESSIONS_ROOT ?? join(homedir(), ".dsh", "sessions"),
		holderStart: typeof holder === "object" ? holder.start : holder,
		srcTime: env.SRC_COMMIT_TIME ? Number(env.SRC_COMMIT_TIME) : srcCommitTime(),
	}));
}
