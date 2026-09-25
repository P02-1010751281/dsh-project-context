#!/usr/bin/env node
/**
 * Backfill ended dsh sessions into a project's memory archive.
 *
 * The live plugin archives sessions it sees; sessions that ended before it was
 * installed can be admitted here instead — same layout, same rendering, same
 * mechanical index, no model call:
 *
 *   .agents/memory/session-logs/<session-id>/{session.jsonl,session.md}
 *   .agents/memory/session-logs/INDEX.md
 *
 * Usage:
 *   node scripts/import-archives.mjs --project <dir> <archive.zip|session.jsonl|dir>…
 *   node scripts/import-archives.mjs --project . --replace sessions_archive/
 *   node scripts/import-archives.mjs --project . --dry-run sessions_archive/
 *
 * Options:
 *   --project <dir>   project root (default: cwd; its .agents/memory receives the archives)
 *   --replace         overwrite sessions that are already archived (default: skip)
 *   --no-md           skip the session.md rendering (only the canonical JSONL + index)
 *   --dry-run         parse and report, write nothing
 *   --quiet           only print the summary
 * Exit code: 0 all good / 1 something failed / 2 bad usage.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { importArchiveFiles } from "../lib/project-context/import.js";
import { parseSessionJsonl } from "../lib/project-context/session-jsonl.js";
import { readArchiveFile } from "../lib/project-context/zip.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const projectRoot = path.resolve(value("--project", process.cwd()));
const replace = flag("--replace");
const markdown = !flag("--no-md");
const dryRun = flag("--dry-run");
const quiet = flag("--quiet");

const positional = [];
for (let index = 0; index < argv.length; index++) {
	const token = argv[index];
	if (token === "--project") { index++; continue; }
	if (token.startsWith("--")) continue;
	positional.push(token);
}

if (positional.length === 0) {
	console.error("usage: node scripts/import-archives.mjs --project <dir> <archive.zip|session.jsonl|dir>… [--replace] [--no-md] [--dry-run] [--quiet]");
	process.exit(2);
}

/** Directories contribute their *.jsonl / *.zip entries (non-recursive); files are taken as given. */
async function expand(targets) {
	const files = [];
	for (const token of targets) {
		const target = path.resolve(process.cwd(), token);
		let info;
		try {
			info = await stat(target);
		} catch {
			console.error(`skip (not found): ${token}`);
			continue;
		}
		if (info.isDirectory()) {
			for (const entry of await readdir(target)) {
				if (/\.(jsonl|zip)$/i.test(entry)) files.push(path.join(target, entry));
			}
		} else {
			files.push(target);
		}
	}
	return files.sort();
}

const files = await expand(positional);
if (files.length === 0) {
	console.error("no archives found");
	process.exit(1);
}

if (dryRun) {
	let sessions = 0;
	let events = 0;
	let failed = 0;
	for (const file of files) {
		try {
			const parsed = parseSessionJsonl(await readArchiveFile(file));
			sessions += 1;
			events += parsed.entries.length;
			if (!quiet) console.log(`would import ${path.basename(file)} → ${parsed.header.id} (${parsed.entries.length} events)`);
		} catch (error) {
			failed += 1;
			console.error(`FAIL ${path.basename(file)}: ${error.message}`);
		}
	}
	console.log(`dry-run: ${sessions} archive(s), ${events} events, ${failed} failed → ${projectRoot}/.agents/memory/session-logs`);
	process.exit(failed > 0 ? 1 : 0);
}

const outcomes = await importArchiveFiles(files, { projectRoot, markdown, replace });
for (const outcome of outcomes) {
	if (outcome.status === "created" && !quiet) console.log(`imported ${path.basename(outcome.source ?? outcome.id)} → ${outcome.id} (${outcome.entries} events)`);
	if (outcome.status === "skipped" && !quiet) console.log(`skipped (already archived): ${outcome.id}`);
	if (outcome.status === "failed") console.error(`FAIL ${path.basename(outcome.source ?? outcome.id)}: ${outcome.error}`);
}
const created = outcomes.filter((outcome) => outcome.status === "created").length;
const skipped = outcomes.filter((outcome) => outcome.status === "skipped").length;
const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
console.log(`archives: created ${created}, skipped ${skipped}, failed ${failed} → ${projectRoot}/.agents/memory/session-logs`);
process.exit(failed > 0 ? 1 : 0);
