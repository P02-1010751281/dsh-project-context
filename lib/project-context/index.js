/**
 * project-context — the session archive (pass ①, no model calls).
 *
 * Writes the per-session raw JSONL and Markdown rendering plus the mechanical
 * session index under `.agents/memory/session-logs/`. Distilling the archive
 * into CONTEXT.md/MEMORY.md is the memory feature (`project-memory`); reading
 * it back for skills is autolearn (`project-autolearn`); pointing a fresh
 * session at it is handoff (`project-handoff`).
 *
 * Commands: /context, /session-log (bare = read state, `write` = write now, `tree` = the handoff lineage,
 * `import <archive…>` = backfill)
 */
import { resolvePluginConfig } from "../shared/config.js";
import { PluginSettingsSchema, effectivePluginConfig, publishProjectContextSettings } from "../shared/settings.js";
import { projectCwd, isTopLevel, SessionWorkTracker } from "../shared/lifecycle.js";
import { contextFile, getProjectRoot, logsDir, sessionIndexFile } from "../shared/project-state.js";
import { renderTaskDocument } from "../project-memory/context-doc.js";
import { dateStamp, deriveTaskStatus, listTasks, parseTaskMeta, readSessionTaskSync, readTask, taskRelativePath, taskViews, validTaskSlug, withTaskStatus, writeTaskDocument } from "../project-memory/tasks.js";
import { importArchiveFiles } from "./import.js";
import { queueSessionArtifacts, releaseSessionQueue, writeSessionArtifacts } from "./session-log.js";
import { reconcileSessionIndexOnce, setSessionTask } from "./session-index.js";
import { readSessionTree } from "./session-tree.js";
import { logError } from "../shared/error-log.js";
/**
 * Expand `/session-log import` arguments: directories contribute their
 * `*.jsonl` and `*.zip` entries (non-recursive), files are taken as given.
 */
async function resolveImportTargets(args, cwd) {
    const { readdir, stat } = await import("node:fs/promises");
    const path = await import("node:path");
    const files = [];
    for (const token of args.split(/\s+/).filter(Boolean)) {
        const target = path.resolve(cwd, token);
        let info;
        try {
            info = await stat(target);
        }
        catch {
            continue;
        }
        if (info.isDirectory()) {
            for (const entry of await readdir(target)) {
                if (/\.(jsonl|zip)$/i.test(entry))
                    files.push(path.join(target, entry));
            }
        }
        else {
            files.push(target);
        }
    }
    return files.sort();
}
export const name = "project-context";
export const inject = ["commands"];
/**
 * The settings schema the Host projects into the Plugins page, and the one namespace all four
 * plugins share: the entry id below (`project-context`) is what the web card edits, and
 * {@link publishProjectContextSettings} republishes the value this entry was applied with.
 */
export const Config = PluginSettingsSchema;
export function apply(ctx, rawConfig) {
    const entry = resolvePluginConfig(rawConfig);
    publishProjectContextSettings(ctx, entry);
    /** In-flight archive work per session, awaited by durability flushes. */
    const pending = new SessionWorkTracker();
    ctx.on("agent/created", ({ agent }) => {
        // The cache warm has no artifact of its own (one `git rev-parse`), but the reconcile that rides
        // on the same root resolve does: it rewrites `INDEX.md`, so it honours the same `archiveEnabled`
        // switch as the four write points below. This is the startup half of the index contract — a
        // directory that appeared with no session write (a wholesale migration, an install whose archive
        // path never ran) is otherwise only picked up by some unrelated session's next write.
        void getProjectRoot(projectCwd(agent.session))
            .then(async (projectRoot) => {
            if (!effectivePluginConfig(entry).archiveEnabled)
                return;
            try {
                await reconcileSessionIndexOnce(projectRoot);
            }
            catch (error) {
                // The root is known here, so the line lands in this project's errors.log; the outer
                // catch stays silent because a failed root resolve is already reported by the paths
                // that need it and this one produces nothing.
                await logError(projectRoot, "session-index", error);
            }
        })
            .catch(() => undefined);
        return undefined;
    });
    // A delegated child inherits the parent's cwd, so every child used to archive itself into the
    // project's session-logs and index. The 2026-09-27 census found 67 of 113 archive directories were
    // `origin: "subagent"` children — those originals are kept in
    // `/mnt/Data/Backups/dsh-project-context/session-logs-subagent-2026-09-27.tar.gz`, so the number
    // stays checkable — and they were already a majority of the newest-50 window autolearn reads
    // (`MAX_INDEX_ENTRIES` in project-autolearn). The other three plugins refuse a child on their own
    // lifecycle points; this one now does too.
    //
    // Non-goal: the explicit `/session-log write` and `import` commands stay ungated — an explicit
    // command is the user asking, which is also how `archiveEnabled: false` is documented — so a child
    // whose owner runs one still writes its own directory and index line.
    ctx.on("session/event", (session, event) => {
        if (event.type !== "turn/end")
            return;
        if (!isTopLevel(session))
            return;
        if (!effectivePluginConfig(entry).archiveEnabled)
            return;
        void queueSessionArtifacts(session, { markdown: false });
    });
    // The canonical JSONL is refreshed on every turn end; the Markdown rendering
    // and the session index are written when the agent settles or is disposed.
    ctx.on("agent/status", ({ agent, status }) => {
        if (status !== "idle")
            return;
        if (!isTopLevel(agent.session))
            return;
        if (!effectivePluginConfig(entry).archiveEnabled)
            return;
        pending.track(agent.session, queueSessionArtifacts(agent.session, { markdown: true }));
    });
    ctx.on("agent/disposed", ({ agent }) => {
        if (!isTopLevel(agent.session))
            return;
        if (!effectivePluginConfig(entry).archiveEnabled)
            return;
        pending.track(agent.session, queueSessionArtifacts(agent.session, { markdown: true }));
    });
    ctx.on("session/flush", (session) => pending.flush(session));
    ctx.on("session/disposed", (session) => {
        // Either refusal still drops the queue entry: the per-session cursors are populated by
        // writing, which no automatic path can do once refused — but the ungated `/session-log write`
        // command writes under the very same session key, and without this the cursor would outlive
        // the session.
        if (!isTopLevel(session))
            return releaseSessionQueue(session);
        // The same flag the other three points honour. This point used to write anyway, so turning
        // archiving off still produced a session.jsonl + session.md + index line on dispose, against
        // README's "关掉后不再自动写会话存档与索引".
        if (!effectivePluginConfig(entry).archiveEnabled)
            return releaseSessionQueue(session);
        void queueSessionArtifacts(session, { markdown: true }).finally(() => releaseSessionQueue(session));
    });
    ctx.commands.register({
        name: "context",
        description: "Show the project context and session log locations, or bind this session to a task",
        input: { hint: "task [<slug> [new|archive|activate]] | task none" },
        handler: async ({ agent, rawInput }) => {
            const projectRoot = await getProjectRoot(projectCwd(agent.session));
            const config = effectivePluginConfig(entry);
            const today = dateStamp();
            const sessionId = String(agent.session.id);
            const bound = readSessionTaskSync(projectRoot, sessionId);
            const lines = [
                `Project context: ${contextFile(projectRoot)}`,
                `Session logs: ${logsDir(projectRoot)}`,
                `Session index: ${sessionIndexFile(projectRoot)}`,
                `Task: ${bound === undefined ? "unbound (this session uses the project context)" : bound}`,
            ];
            const args = (rawInput ?? "").trim();
            if (args === "")
                return { kind: "success", text: lines.join("\n") };
            const tokens = args.split(/\s+/);
            if (tokens[0] !== "task")
                return { kind: "error", text: `Unknown option "${tokens[0]}". Usage: /context | /context task [<slug> [new|archive|activate]] | /context task none` };
            const rest = tokens.slice(1);
            try {
                // The bare list is the "what tasks exist" read, and it is where a user discovers the
                // statuses: derived for this project's mode and today, never a stale stored value.
                if (rest.length === 0) {
                    const views = taskViews(await listTasks(projectRoot), { mode: config.taskMode, today });
                    if (views.length === 0)
                        return { kind: "success", text: `${lines.join("\n")}\nNo tasks yet. Create one with /context task <slug> new` };
                    const rows = views.map((view) => `- ${view.slug} · ${view.status} · ${view.meta.title || view.slug}${view.slug === bound ? " (this session)" : ""}`);
                    return { kind: "success", text: [...lines, "", ...rows].join("\n") };
                }
                const [slug, verb, extra] = rest;
                // `none` is the unbind: a session that goes back to the project-level context, which is the
                // behaviour every session had before this dimension existed.
                if (slug === "none") {
                    if (bound === undefined)
                        return { kind: "success", text: "Task: this session is already unbound." };
                    await setSessionTask(projectRoot, agent.session, undefined);
                    return { kind: "success", text: "Task: unbound this session; it uses the project context again." };
                }
                if (!validTaskSlug(slug))
                    return { kind: "error", text: `"${slug}" is not a task slug; use lowercase letters, digits and inner hyphens (e.g. release).` };
                if (extra !== undefined)
                    return { kind: "error", text: "Usage: /context task <slug> [new|archive|activate] | /context task none" };
                const existing = await readTask(projectRoot, slug);
                if (verb === "new") {
                    if (existing !== undefined)
                        return { kind: "error", text: `Task "${slug}" already exists at ${taskRelativePath(slug)}; bind it with /context task ${slug}.` };
                    // An explicit `new` is the user's confirmation, so this is the one path that creates a
                    // task in every mode: the spec's "creating a slug needs the user's confirmation" is
                    // enforced by the verb, not by refusing the user's own command.
                    const meta = { created: today, status: "active", lastSeen: today, title: slug };
                    const document = renderTaskDocument({ title: slug, summary: "", key_points: [], open_tasks: [] }, { updatedAt: new Date().toISOString(), slug, meta }).text;
                    await writeTaskDocument(projectRoot, slug, document);
                    await setSessionTask(projectRoot, agent.session, slug);
                    return { kind: "success", text: `Task: created ${taskRelativePath(slug)} and bound this session to it.` };
                }
                if (verb === "archive" || verb === "activate") {
                    if (existing === undefined)
                        return { kind: "error", text: `Task "${slug}" does not exist. Create it with /context task ${slug} new` };
                    await writeTaskDocument(projectRoot, slug, withTaskStatus(existing.text, verb === "archive" ? "archived" : "active", today));
                    return {
                        kind: "success",
                        text: verb === "archive"
                            ? `Task: archived ${slug}; it is no longer injected, so a session bound to it uses the project context.`
                            : `Task: activated ${slug}.`,
                    };
                }
                if (verb !== undefined)
                    return { kind: "error", text: `Unknown option "${verb}". Usage: /context task <slug> [new|archive|activate]` };
                // A bare slug binds an existing task. `delegated` treats the declaration itself as enough
                // and creates the file; `assisted` and `manual` refuse, and name the verb that would create
                // it — the model may propose a task only through this command, so the refusal is where the
                // user's confirmation is asked for.
                if (existing === undefined) {
                    if (config.taskMode !== "delegated") {
                        return { kind: "error", text: `Task "${slug}" does not exist. Create it with /context task ${slug} new (taskMode is ${config.taskMode}).` };
                    }
                    const meta = { created: today, status: "active", lastSeen: today, title: slug };
                    await writeTaskDocument(projectRoot, slug, renderTaskDocument({ title: slug, summary: "", key_points: [], open_tasks: [] }, { updatedAt: new Date().toISOString(), slug, meta }).text);
                    await setSessionTask(projectRoot, agent.session, slug);
                    return { kind: "success", text: `Task: created ${taskRelativePath(slug)} (taskMode delegated) and bound this session to it.` };
                }
                // A hand-edited file without a metadata line cannot report an age; treat it as active rather
                // than guessing, and let the next consolidation pass rewrite the line.
                const meta = parseTaskMeta(existing.text);
                const status = meta === undefined ? "active" : deriveTaskStatus(meta, { mode: config.taskMode, today });
                if (status === "archived") {
                    return { kind: "error", text: `Task "${slug}" is archived, so it is not injected. Reactivate it with /context task ${slug} activate` };
                }
                await setSessionTask(projectRoot, agent.session, slug);
                return { kind: "success", text: `Task: bound this session to ${slug} (${status}); its state is ${taskRelativePath(slug)}.` };
            }
            catch (error) {
                // A command handler never throws: the failure is a receipt, and the diagnostic goes to the
                // project's own log.
                await logError(projectRoot, "memory", error);
                return { kind: "error", text: `Task: the command failed — ${error instanceof Error ? error.message : String(error)} (see .agents/memory/errors.log).` };
            }
        },
    });
    ctx.commands.register({
        name: "session-log",
        description: "Show the session log location and index; `write` writes the current session's artifacts, `tree` shows the handoff lineage, `import <path…>` backfills ended sessions",
        input: { hint: "write | tree | import <session.jsonl|archive.zip|dir>…" },
        handler: async ({ agent, rawInput }) => {
            const args = rawInput.trim();
            // The bare command is the "what is my state" habit, so it reads; `write` writes. `now` was the
            // old spelling of the write and is retired rather than kept as an alias (one fact, one spelling),
            // so it gets told which name to use instead of quietly doing nothing.
            if (args === "now")
                return { kind: "error", text: "`/session-log now` was retired; use `/session-log write`." };
            if (args === "write") {
                const result = await writeSessionArtifacts(agent.session);
                return { kind: "success", text: `Session log written: ${result.dir}` };
            }
            if (args === "") {
                const projectRoot = await getProjectRoot(projectCwd(agent.session));
                return {
                    kind: "success",
                    text: `Session logs: ${logsDir(projectRoot)}\nSession index: ${sessionIndexFile(projectRoot)}\nWrite now: /session-log write`,
                };
            }
            // The tree is a read of the archive's own metadata, so it sits with the bare reads rather than
            // with the import path: a project with a directory named `tree` would otherwise shadow it, and
            // the command is what a user reaches for when the flat index stops answering "which one
            // continued which".
            if (args === "tree") {
                const projectRoot = await getProjectRoot(projectCwd(agent.session));
                try {
                    return { kind: "success", text: await readSessionTree(projectRoot) };
                }
                catch (error) {
                    // A command handler never throws: the failure is a receipt plus one log line.
                    await logError(projectRoot, "memory", error);
                    return { kind: "error", text: `Session tree: the command failed — ${error instanceof Error ? error.message : String(error)} (see .agents/memory/errors.log).` };
                }
            }
            const files = await resolveImportTargets(args.replace(/^import\s+/, "").trim(), projectCwd(agent.session));
            if (files.length === 0)
                return { kind: "error", text: "No archives found. Usage: /session-log import <session.jsonl|archive.zip|dir>…" };
            const projectRoot = await getProjectRoot(projectCwd(agent.session));
            const outcomes = await importArchiveFiles(files, { projectRoot });
            const created = outcomes.filter((outcome) => outcome.status === "created");
            const skipped = outcomes.filter((outcome) => outcome.status === "skipped");
            const failed = outcomes.filter((outcome) => outcome.status === "failed");
            const head = `Imported ${created.length} archive(s) into ${logsDir(projectRoot)}`;
            const detail = [
                skipped.length > 0 ? `skipped ${skipped.length} existing` : "",
                failed.length > 0 ? `failed ${failed.length}: ${failed.map((outcome) => `${outcome.source ?? outcome.id} (${outcome.error})`).join("; ")}` : "",
            ].filter(Boolean).join("; ");
            const summary = detail ? `${head} (${detail})` : head;
            return failed.length > 0 ? { kind: "error", text: summary } : { kind: "success", text: summary };
        },
    });
}
