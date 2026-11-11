/**
 * Read the plugin code the running dsh host actually executes, and name its commit.
 *
 * The process start time is not a reliable criterion here: on 2026-11-11 a host started at 10:41:56
 * was executing the 13:54:51 build, so the code had been swapped without a restart. What cannot lie
 * is the module source resident in the live isolate — this reads it through the host's inspector and
 * matches it byte-for-byte against `git show <commit>:lib/<file>`.
 *
 * Usage: node probe.mjs [--port 9230] [--file lib/project-memory/retirement.js] [--repo <path>]
 * Prints one JSON object: the resident copies, their sha256, and the commits whose committed `lib/`
 * blob has the same hash. Read-only: `Debugger.enable` is the only mutation and it is disabled again.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
};

const port = option("port", "9230");
const file = option("file", "lib/project-memory/retirement.js");
const repo = option("repo", process.cwd());
/** How many recent commits to test the resident hash against. */
const HISTORY = 40;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((entry) => entry.webSocketDebuggerUrl);
if (target === undefined) throw new Error(`no inspector target on ${port}`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const parsed = [];
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});

socket.addEventListener("message", (event) => {
	const message = JSON.parse(event.data);
	if (message.id !== undefined && pending.has(message.id)) {
		const { resolve, reject } = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) reject(new Error(message.error.message));
		else resolve(message.result);
		return;
	}
	if (message.method === "Debugger.scriptParsed") parsed.push(message.params);
});

await new Promise((resolve, reject) => {
	socket.addEventListener("open", resolve, { once: true });
	socket.addEventListener("error", reject, { once: true });
});

await send("Debugger.enable");
// The isolate reports every script it has already parsed once the Debugger domain is enabled; a
// short settle window is enough for a host this size and keeps the debugger enabled time tiny.
await new Promise((resolve) => setTimeout(resolve, 2000));

const wanted = `/${file}`;
const copies = [];
for (const script of parsed) {
	if (!script.url.startsWith("file://") || !script.url.endsWith(wanted)) continue;
	const { scriptSource } = await send("Debugger.getScriptSource", { scriptId: script.scriptId });
	copies.push({ scriptId: script.scriptId, chars: scriptSource.length, sha256: createHash("sha256").update(scriptSource).digest("hex") });
}

const commits = execFileSync("git", ["-C", repo, "log", `-${HISTORY}`, "--format=%H %ci %s"], { encoding: "utf8" })
	.trim()
	.split("\n");
const byHash = new Map();
for (const line of commits) {
	const [hash, ...rest] = line.split(" ");
	let blob;
	try {
		// stderr is silenced: a commit from before the file existed is a miss, not an error to print.
		blob = execFileSync("git", ["-C", repo, "show", `${hash}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		continue;
	}
	const digest = createHash("sha256").update(blob).digest("hex");
	if (!byHash.has(digest)) byHash.set(digest, []);
	byHash.get(digest).push(`${hash.slice(0, 7)} ${rest.slice(1).join(" ")}`);
}

const disk = createHash("sha256").update(execFileSync("cat", [`${repo}/${file}`])).digest("hex");
console.log(JSON.stringify({
	port,
	file,
	residentCopies: copies.map((copy) => ({ ...copy, commits: byHash.get(copy.sha256) ?? ["no committed blob in the last " + HISTORY + " commits"] })),
	diskSha256: disk,
	diskCommits: byHash.get(disk) ?? [],
	verdict: copies.length === 0
		? "not loaded (the file is not parsed in this isolate)"
		: copies.every((copy) => copy.sha256 === disk)
			? "the running host executes the code on disk"
			: "STALE: the resident module differs from the file on disk — a restart or a plugin re-apply is still required",
}, null, "\t"));

await send("Debugger.disable");
socket.close();
