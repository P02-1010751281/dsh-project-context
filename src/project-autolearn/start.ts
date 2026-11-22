/**
 * The autolearn core: registration and the pass trigger, behind the host façade.
 *
 * This module registers nothing with a framework. It receives the {@link HostContext} the entry
 * built from its cordis context and only calls `host.on` / `host.registerCommand`; the pass and the
 * expiry transition receive the narrower {@link HostPorts} they actually read.
 *
 * Commands: /autolearn
 */

import path from "node:path";
import type { Agent, HostContext, HostPorts } from "../host/contract.js";
import { type PluginConfig } from "../shared/config.js";
import { effectivePluginConfig } from "../shared/settings.js";
import { isTopLevel, projectCwd, SerialQueue, SessionWorkTracker } from "../shared/lifecycle.js";
import { approveCandidate, listCandidateDetails, rejectCandidate } from "./candidate.js";
import { evidenceText } from "./evidence.js";
import { readEvidenceCorpus } from "./evidence-source.js";
import { autolearnProjectSkills, type AutolearnOutcome } from "./pass.js";
import { bindSkills, expireSkill, measureSkillStates, retireExpiredSkills } from "./skill-state-source.js";
import { skillStatusReceipt } from "./skill-state.js";
import { diagnosticMessage, getProjectRoot, logError, skillsDir } from "../shared/project-state.js";

/** Serialize passes so a forced command waits for an in-flight automatic one. */
const updates = new SerialQueue();

interface RunOptions {
	force: boolean;
	silent: boolean;
	signal?: AbortSignal | undefined;
	/**
	 * Hand the pass's write segments to the caller's durability tracker.
	 *
	 * The pass registers only segments that await no model call: its auxiliary call names a live
	 * session, so a registration spanning that call would make the call's own checkpoint flush await
	 * the call it is dispatching (`SessionWorkTracker`).
	 */
	track?: ((work: Promise<unknown>) => void) | undefined;
}

/**
 * The expiry transition on its own: no model call and no queue, so it can run when the pass is off.
 *
 * The move logs its own line per skill; this wrapper only keeps a throw from escaping and records it.
 * @param host - the ports, for the warning line.
 * @param agent - the session whose project is judged.
 * @param silent - suppress the warning while the UI is already rebuilding.
 */
async function runSkillExpiry(host: HostPorts, agent: Agent, silent: boolean): Promise<void> {
	const projectRoot = await getProjectRoot(projectCwd(agent.session));
	try {
		await retireExpiredSkills(projectRoot);
	} catch (error) {
		await logError(projectRoot, "autolearn", error);
		if (!silent) host.log.warn(`dsh-project-context: skill expiry failed: ${diagnosticMessage(error)}`);
	}
}

/** Run one pass; the outcome is kept for command reporting while the queue only sees void. */
function runAutolearn(host: HostPorts, config: PluginConfig, agent: Agent, options: RunOptions): Promise<AutolearnOutcome | undefined> {
	let outcome: AutolearnOutcome | undefined;
	return updates.run(async () => {
		const projectRoot = await getProjectRoot(projectCwd(agent.session));
		try {
			// The system-fired transition, before the pass spends a model call: a learned skill whose
			// cited files are all gone is moved out of the harness's view and logged. Its own switch,
			// so turning expiry off never keeps the pass from distilling.
			if (config.autolearnExpireSkills) await retireExpiredSkills(projectRoot);
			outcome = await autolearnProjectSkills(host, agent, config, { force: options.force, signal: options.signal, track: options.track });
			if (outcome?.candidate && !options.silent) {
				host.log.info(`dsh-project-context: skill candidate saved for review: /autolearn approve ${outcome.skill?.name ?? ""}`);
			} else if (outcome?.skill && !options.silent) {
				host.log.info(`dsh-project-context: project skill created: ${path.join(skillsDir(projectRoot), outcome.skill.name, "SKILL.md")}`);
			}
		} catch (error) {
			await logError(projectRoot, "autolearn", error);
			if (!options.silent) host.log.warn(`dsh-project-context: autolearn failed: ${diagnosticMessage(error)}`);
		}
	}).then(() => outcome);
}

/**
 * Start the plugin behind the façade.
 * @param host - the registration façade and ports the entry built.
 * @param entry - the resolved plugin config, shared with the other three plugins.
 */
export function start(host: HostContext, entry: PluginConfig): void {
	/** In-flight autolearn work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();

	host.on("agent/status", ({ agent, status }) => {
		if (status !== "idle" || !isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.autolearnEnabled) {
			// Expiry keeps its own switch, so a project that turned distillation off still retires a
			// skill pointing at deleted code — silently, and without the model call the pass would spend.
			if (current.autolearnExpireSkills) void runSkillExpiry(host, agent, false).catch(() => undefined);
			return;
		}
		// Only the pass's write segments reach the tracker (`SessionWorkTracker`); the span itself is
		// observed here so a rejection stays as invisible as it was when the tracker carried it.
		void runAutolearn(host, current, agent, { force: false, silent: false, track: (work) => pending.track(agent.session, work) }).catch(() => undefined);
	});

	host.on("agent/disposed", ({ agent }) => {
		if (!isTopLevel(agent.session)) return;
		const current = effectivePluginConfig(entry);
		if (!current.autolearnEnabled) {
			if (current.autolearnExpireSkills) void runSkillExpiry(host, agent, true).catch(() => undefined);
			return;
		}
		// Silent: the UI may already be rebuilding for a session switch.
		void runAutolearn(host, current, agent, { force: false, silent: true, track: (work) => pending.track(agent.session, work) }).catch(() => undefined);
	});

	host.on("session/flush", (session) => pending.flush(session));

	host.registerCommand({
		name: "autolearn",
		description: "Distill a project skill from memory, context, and archived sessions; also: list | status | bind | expire <name> | approve <name> | reject <name>",
		input: { hint: "list | status | bind | expire <name> | approve <name> | reject <name>" },
		handler: async ({ agent, rawInput, signal }) => {
			const parts = (rawInput ?? "").trim().split(/\s+/).filter(Boolean);
			const verb = (parts[0] ?? "").toLowerCase();
			const projectRoot = await getProjectRoot(projectCwd(agent.session));
			if (verb === "list") {
				// Two groups, because they answer two questions: which proposals wait for a decision, and
				// what the learned population already records as its provenance. A learned skill from before
				// this batch records no evidence, and the line says exactly that instead of failing the read.
				const candidates = await listCandidateDetails(projectRoot);
				const learned = (await readEvidenceCorpus(projectRoot)).skills.filter((skill) => skill.learned);
				const lines = [candidates.length > 0 ? "Skill candidates:" : "No skill candidates."];
				for (const candidate of candidates) lines.push(`- ${candidate.name} · evidence ${evidenceText(candidate.evidence)}`);
				if (learned.length > 0) lines.push("Learned project skills:");
				for (const skill of learned) lines.push(`- ${skill.name} · evidence ${evidenceText(skill.evidence)}`);
				return { kind: "success" as const, text: lines.join("\n") };
			}
			if (verb === "approve") {
				const result = await approveCandidate(projectRoot, parts[1]);
				return result.ok ? { kind: "success" as const, text: result.message } : { kind: "error" as const, text: result.message };
			}
			if (verb === "status") {
				// Read-only on purpose: a status that bound a baseline would change what the next status says.
				// A corpus that predates the baselines is reported as unbaselined with `/autolearn bind` as
				// its remedy, never silently adopted.
				return { kind: "success" as const, text: skillStatusReceipt(await measureSkillStates(projectRoot)) };
			}
			if (verb === "bind") {
				const { bound, skipped } = await bindSkills(projectRoot);
				const total = bound.reduce((sum, entry) => sum + entry.paths, 0);
				// Two lines, two facts: what a baseline now covers, and what no baseline can ever cover.
				// Without the second line a reader keeps re-running bind for skills whose only citations
				// are build output, memory documents or paths outside the project.
				const covered = bound.length === 0
					? "Learned skills: every bindable skill already carries a baseline; nothing to bind."
					: `Learned skills: recorded a baseline for ${bound.length} skill(s) (${total} cited file(s)): ${bound.map((entry) => entry.name).join(", ")}`;
				const skippedLine = skipped.length === 0
					? ""
					: `\nLearned skills: ${skipped.length} skill(s) have no bindable path (only build output, memory documents, or paths outside the project): ${skipped.join(", ")}`;
				return { kind: "success" as const, text: covered + skippedLine };
			}
			if (verb === "expire") {
				const result = await expireSkill(projectRoot, parts[1] ?? "");
				if (result.status === "moved") return { kind: "success" as const, text: `Learned skill "${parts[1]}" moved out of service: ${result.to}` };
				if (result.status === "no-such-skill") return { kind: "error" as const, text: `No learned skill named "${parts[1] ?? ""}".` };
				if (result.status === "unbaselined") return { kind: "error" as const, text: `Skill "${parts[1]}" has no baseline yet; run /autolearn bind first so expiry has something to judge.` };
				return { kind: "error" as const, text: `Skill "${parts[1]}" is ${result.state}, not expired; nothing was moved.` };
			}
			if (verb === "reject") {
				const result = await rejectCandidate(projectRoot, parts[1]);
				return result.ok ? { kind: "success" as const, text: result.message } : { kind: "error" as const, text: result.message };
			}
			const outcome = await runAutolearn(host, effectivePluginConfig(entry), agent, { force: true, silent: false, signal });
			if (outcome === undefined) return { kind: "error", text: "Autolearn did not run (no provider/model, or the pass failed; see errors.log)." };
			if (outcome.candidate && outcome.skill) {
				return { kind: "success", text: `Skill candidate "${outcome.skill.name}" saved for review — /autolearn approve ${outcome.skill.name}` };
			}
			return outcome.skill
				? { kind: "success", text: `Skill created: ${outcome.skill.name}` }
				// Report the actual cause instead of "No new skill was warranted", which asserted the
				// model proposed nothing. That claim is false on three reachable paths: an admission
				// rule refused a real proposal, the pass skipped the model call entirely, or the
				// model answered with an unusable payload. Each gets its own sentence; only the last
				// one talks about the model, and it says only what is verifiable.
				: outcome.rejected !== undefined
					? { kind: "success", text: `Skill rejected: ${outcome.rejected}. Nothing was written; adjust the project material or the skill shape and run /autolearn again.` }
					: outcome.skipped !== undefined
						? { kind: "success", text: `No skill was considered: ${outcome.skipped}.` }
						: { kind: "success", text: "No new skill was created: the model's answer contained no usable skill." };
		},
	});
}
