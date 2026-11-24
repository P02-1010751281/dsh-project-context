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
import { type PluginConfig, resolveAutolearnConfig } from "../shared/config.js";
import { effectiveSharedSettings, livePluginConfig, withShared } from "../shared/settings.js";
import { isTopLevel, projectCwd, SerialQueue, SessionWorkTracker } from "../shared/lifecycle.js";
import { approveCandidate, listCandidateDetails, rejectCandidate } from "./candidate.js";
import { evidenceText } from "./evidence.js";
import { readEvidenceCorpus } from "./evidence-source.js";
import { autolearnProjectSkills, type AutolearnOutcome } from "./pass.js";
import { rejectedText, skippedText } from "./reasons.js";
import { bindSkills, expireSkill, measureSkillStates, retireExpiredSkills } from "./skill-state-source.js";
import { skillStatusReceipt } from "./skill-state.js";
import { pick } from "../shared/language.js";
import { diagnosticMessage, getProjectRoot, logError, skillsDir } from "../shared/project-state.js";
import { receiptLanguage } from "../shared/receipt-language.js";

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
	/**
	 * This entry's own keys, re-resolved on every call, overlaid with the shared nine.
	 *
	 * The `entry` handed to `apply` is a snapshot: a volatile-only save lands in the running
	 * fiber's live references and never restarts the entry, so reading the snapshot would show
	 * a saved value in the card and keep using the old one. The shared nine come from the
	 * `project-context` publication (or this entry's own values when it is not loaded).
	 */
	const currentConfig = (): PluginConfig => withShared(livePluginConfig(host, entry, resolveAutolearnConfig), effectiveSharedSettings(entry));
	/** In-flight autolearn work per session, awaited by durability flushes. */
	const pending = new SessionWorkTracker();

	host.on("agent/status", ({ agent, status }) => {
		if (status !== "idle" || !isTopLevel(agent.session)) return;
		const current = currentConfig();
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
		const current = currentConfig();
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
			// One language for every `/autolearn` receipt, resolved at the handler.
			const language = receiptLanguage(agent.session, currentConfig());
			if (verb === "list") {
				// Two groups, because they answer two questions: which proposals wait for a decision, and
				// what the learned population already records as its provenance. A learned skill from before
				// this batch records no evidence, and the line says exactly that instead of failing the read.
				const candidates = await listCandidateDetails(projectRoot);
				const learned = (await readEvidenceCorpus(projectRoot)).skills.filter((skill) => skill.learned);
				const lines = [candidates.length > 0
					? pick(language, "技能候选：", "Skill candidates:")
					: pick(language, "没有技能候选。", "No skill candidates.")];
				const evidenceLabel = pick(language, " · 证据 ", " · evidence ");
				for (const candidate of candidates) lines.push(`- ${candidate.name}${evidenceLabel}${evidenceText(candidate.evidence, language)}`);
				if (learned.length > 0) lines.push(pick(language, "已学到的项目技能：", "Learned project skills:"));
				for (const skill of learned) lines.push(`- ${skill.name}${evidenceLabel}${evidenceText(skill.evidence, language)}`);
				return { kind: "success" as const, text: lines.join("\n") };
			}
			if (verb === "approve") {
				const result = await approveCandidate(projectRoot, parts[1] ?? "", language);
				return result.ok ? { kind: "success" as const, text: result.message } : { kind: "error" as const, text: result.message };
			}
			if (verb === "status") {
				// Read-only on purpose: a status that bound a baseline would change what the next status says.
				// A corpus that predates the baselines is reported as unbaselined with `/autolearn bind` as
				// its remedy, never silently adopted. The language is resolved here, at the handler, not left
				// to the builder's `"en"` default: a Chinese session used to get an English autolearn line
				// beside a Chinese `/memory` one.
				return {
					kind: "success" as const,
					text: skillStatusReceipt(
						await measureSkillStates(projectRoot),
						receiptLanguage(agent.session, currentConfig()),
					),
				};
			}
			if (verb === "bind") {
				const { bound, skipped } = await bindSkills(projectRoot);
				const total = bound.reduce((sum, entry) => sum + entry.paths, 0);
				// Two lines, two facts: what a baseline now covers, and what no baseline can ever cover.
				// Without the second line a reader keeps re-running bind for skills whose only citations
				// are build output, memory documents or paths outside the project.
				const covered = bound.length === 0
					? pick(language, "已学技能：每个可绑定的技能都已有基线；没有需要绑定的。", "Learned skills: every bindable skill already carries a baseline; nothing to bind.")
					: pick(language,
						`已学技能：为 ${bound.length} 个技能记录了基线（共 ${total} 个引用文件）：${bound.map((entry) => entry.name).join("、")}`,
						`Learned skills: recorded a baseline for ${bound.length} skill(s) (${total} cited file(s)): ${bound.map((entry) => entry.name).join(", ")}`);
				const skippedLine = skipped.length === 0
					? ""
					: pick(language,
						`\n已学技能：${skipped.length} 个技能没有可绑定的路径（只有构建产物、记忆文档或项目之外的路径）：${skipped.join("、")}`,
						`\nLearned skills: ${skipped.length} skill(s) have no bindable path (only build output, memory documents, or paths outside the project): ${skipped.join(", ")}`);
				return { kind: "success" as const, text: covered + skippedLine };
			}
			if (verb === "expire") {
				const result = await expireSkill(projectRoot, parts[1] ?? "");
				if (result.status === "moved") return { kind: "success" as const, text: pick(language, `已学技能「${parts[1]}」已移出服役：${result.to}`, `Learned skill "${parts[1]}" moved out of service: ${result.to}`) };
				if (result.status === "no-such-skill") return { kind: "error" as const, text: pick(language, `没有名为「${parts[1] ?? ""}」的已学技能。`, `No learned skill named "${parts[1] ?? ""}".`) };
				if (result.status === "unbaselined") return { kind: "error" as const, text: pick(language, `技能「${parts[1]}」还没有基线；先运行 /autolearn bind，过期判定才有依据。`, `Skill "${parts[1]}" has no baseline yet; run /autolearn bind first so expiry has something to judge.`) };
				return { kind: "error" as const, text: pick(language, `技能「${parts[1]}」的状态是 ${result.state}，不是过期；没有移动任何东西。`, `Skill "${parts[1]}" is ${result.state}, not expired; nothing was moved.`) };
			}
			if (verb === "reject") {
				const result = await rejectCandidate(projectRoot, parts[1] ?? "", language);
				return result.ok ? { kind: "success" as const, text: result.message } : { kind: "error" as const, text: result.message };
			}
			const outcome = await runAutolearn(host, currentConfig(), agent, { force: true, silent: false, signal });
			if (outcome === undefined) return { kind: "error", text: pick(language, "自动学习没有运行（没有 provider/model，或本轮失败；见 errors.log）。", "Autolearn did not run (no provider/model, or the pass failed; see errors.log).") };
			if (outcome.candidate && outcome.skill) {
				return { kind: "success", text: pick(language, `技能候选「${outcome.skill.name}」已保存待审——/autolearn approve ${outcome.skill.name}`, `Skill candidate "${outcome.skill.name}" saved for review — /autolearn approve ${outcome.skill.name}`) };
			}
			return outcome.skill
				? { kind: "success", text: pick(language, `已创建技能：${outcome.skill.name}`, `Skill created: ${outcome.skill.name}`) }
				// Report the actual cause instead of "No new skill was warranted", which asserted the
				// model proposed nothing. That claim is false on three reachable paths: an admission
				// rule refused a real proposal, the pass skipped the model call entirely, or the
				// model answered with an unusable payload. Each gets its own sentence; only the last
				// one talks about the model, and it says only what is verifiable.
				: outcome.rejected !== undefined
					? { kind: "success", text: pick(language,
						`技能被拒：${rejectedText(outcome.rejected, language)}。没有写入任何东西；调整项目素材或技能形态后再运行 /autolearn。`,
						`Skill rejected: ${rejectedText(outcome.rejected, language)}. Nothing was written; adjust the project material or the skill shape and run /autolearn again.`) }
					: outcome.skipped !== undefined
						? { kind: "success", text: pick(language, `没有考虑任何技能：${skippedText(outcome.skipped, language)}。`, `No skill was considered: ${skippedText(outcome.skipped, language)}.`) }
						: { kind: "success", text: pick(language, "没有创建新技能：模型的回答里没有可用的技能。", "No new skill was created: the model's answer contained no usable skill.") };
		},
	});
}
