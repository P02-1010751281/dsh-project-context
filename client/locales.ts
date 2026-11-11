/** Settings-card dictionaries for the `project-context` locale namespace. */

import type { SettingsFormLabels } from "@deepseek-ai/dsh-client-ui-primitives";

import { DEFAULT_HANDOFF_SUMMARY_TOKENS, MAX_THRESHOLD_RATIO, MIN_THRESHOLD_RATIO } from "../src/shared/limits.ts";
import { HANDOFF_BUDGET_RECENT_LABEL } from "../src/shared/setting-labels.ts";

export const zh = {
	"card.title": "项目上下文",
	"card.description": "维护项目 MEMORY.md / CONTEXT.md、项目技能与会话索引",
	"chrome.save": "保存",
	"chrome.saving": "保存中…",
	"chrome.saveFailed": "保存未生效：值可能被拒绝，或设置已被别处改动；修正后重存，或刷新页面再试",
	"chrome.saveFailedRejected": "保存未生效：这个值没有被接受（文档没有被别处改动）。改成合法值后再保存。",
	"chrome.saveFailedConflict": "保存未生效：设置已被别处改动（另一个标签页、/handoff 命令，或宿主重启），当前草稿基于旧版本。刷新页面重新读取后再改并保存。",
	"chrome.unavailable": "该插件当前未加载，暂时无法配置",
	"chrome.invalidNumber": "请填有效数值；留空表示使用默认值",
	"chrome.readOnly": "当前环境的设置为只读",
	"chrome.overridden": "已覆盖",
	"chrome.reset": "重置",
	"section.memory.title": "记忆整理（consolidation）",
	"section.memory.description": "高频：把会话沉淀为 CONTEXT.md 与 MEMORY.md",
	"section.autolearn.title": "技能沉淀（autolearn）",
	"section.autolearn.description": "低频：从记忆/上下文提炼项目技能，缺证据时回读会话存档",
	"field.memoryEnabled": "启用自动整理",
	"field.memoryEnabledHint": "关闭后不再自动整理；/memory update 仍可用",
	"field.archiveEnabled": "启用会话存档",
	"field.archiveEnabledHint": "关闭后不再自动写 session.jsonl / session.md / INDEX.md；/session-log write 仍可用",
	"field.consolidateTurns": "触发轮数",
	"field.consolidateTurnsHint": "本会话用户消息数比上次整理增加该值后触发（仍受最小间隔限制）",
	"field.consolidateIntervalMs": "最小间隔（毫秒）",
	"field.consolidateIntervalMsHint": "两次自动整理之间的最短时间",
	"field.forceDedupeMs": "强制调用去重窗口（毫秒）",
	"field.forceDedupeMsHint": "同一窗口内重复的强制 /memory update 直接返回上一次结果，不再调用模型",
	"field.maxTokens": "输出上限（token）",
	"field.maxTokensHint": "辅助模型调用（整理 / 技能）允许生成的最大 token 数",
	"field.maxOutputTokens": "大输出上限（token）",
	"field.maxOutputTokensHint": "需要更长回答的辅助调用允许生成的最大 token 数，默认 32768",
	"field.maxMemoryChars": "记忆字符上限",
	"field.maxMemoryCharsHint": "MEMORY.md 的字符上限（4000–200000，默认 40000）；超出时按整行裁剪并追加截断标记",
	"field.taskMode": "任务维护模式",
	"field.taskModeHint": "assisted（默认，造任务需显式 /context task <slug> new）、delegated（裸 slug 即建，且 90 天无活动自动归档）或 manual（不自动改状态）",
	"field.provider": "Provider",
	"field.providerHint": "可选的 provider 路由覆盖；记忆整理 / 技能沉淀共用",
	"field.model": "Model",
	"field.modelHint": "可选的 model 覆盖，需与 provider 同时设置；三项功能共用",
	"field.autolearnEnabled": "启用自动技能沉淀",
	"field.autolearnEnabledHint": "关闭后不再自动沉淀；/autolearn 仍可用",
	"field.autolearnTurns": "触发轮数",
	"field.autolearnTurnsHint": "自上次沉淀累计的用户消息数达到该值后触发（与最小间隔取较先满足者）",
	"field.autolearnIntervalMs": "最小间隔（毫秒）",
	"field.autolearnIntervalMsHint": "两次自动沉淀之间的最短时间；仅在 MEMORY/CONTEXT 有新内容时才会执行",
	"section.handoff.title": "自动交接",
	"section.handoff.description": "上下文接近模型上限时另开新会话继续（不调用模型生成摘要）；/handoff 可手动触发",
	"field.handoffEnabled": "启用自动交接",
	"field.handoffEnabledHint": "关闭后自动交接暂停，/handoff 仍可用",
	"field.handoffThreshold": "交接阈值",
	"field.handoffThresholdHint": `auto（默认）按窗口与保留量推导；或写窗口占比 0.4 / 40 / 40%（${MIN_THRESHOLD_RATIO}–${MAX_THRESHOLD_RATIO}），或写绝对 token 数 400k（与 /handoff threshold 相同）。绝对数超过窗口容量时会被截断并在回执里写明；设到 0.8 及以上时 dsh 内置压缩会先触发`,
	"field.handoffBudgetSummaryTokens": "摘要目标（仅报告）",
	"field.handoffBudgetSummaryTokensHint": `仅自适应模式读取；只决定回执里「目标是否被完整采纳」的报告，不移动触发点，也不产生任何模型调用（默认 ${DEFAULT_HANDOFF_SUMMARY_TOKENS}）`,
	"field.handoffBudgetRecentTokens": HANDOFF_BUDGET_RECENT_LABEL.zh,
	"field.handoffBudgetRecentTokensHint": "原样带入新会话的最近对话，0 表示不逐字带入对话尾料（默认 20000；用户最后一次输入不受该值影响，始终单独带入）",
	"field.handoffPendingQuestion": "未答问题的处理",
	"field.handoffPendingQuestionHint": "defer（默认，等用户回答后再交接）或 wait（继续交接，把问题带进新会话）",
	"field.handoffLang": "交接语言",
	"field.handoffLangHint": "auto（默认，跟随会话语言）、zh 或 en",
	"field.handoffRetireReplaced": "交接后归档旧会话",
	"field.handoffRetireReplacedHint": "开启时（默认）交接成功后先停掉旧会话里仍在跑的工作，再把它归档（从侧栏隐藏，可在「全部对话（显示已归档）」里取消归档）；关闭后旧会话留在列表里、其中的工作也不被停掉，但它会排在自己的续接会话上面",
} as const;

export type SettingsCardKey = keyof typeof zh;

export const en: Record<SettingsCardKey, string> = {
	"card.title": "Project Context",
	"card.description": "Maintain project MEMORY.md / CONTEXT.md, skills and the session index",
	"chrome.save": "Save",
	"chrome.saving": "Saving…",
	"chrome.saveFailed": "Save did not land: the value may be rejected, or these settings changed elsewhere — correct it and save again, or reload the page",
	"chrome.saveFailedRejected": "Save did not land: this value was not accepted (the document did not change elsewhere). Correct it and save again.",
	"chrome.saveFailedConflict": "Save did not land: these settings changed elsewhere (another tab, a /handoff command, or a host restart), so the drafts are based on an older version. Reload the page, then edit and save again.",
	"chrome.unavailable": "This plugin is not loaded, so it cannot be configured right now",
	"chrome.invalidNumber": "Enter a valid value, or leave blank to use the default",
	"chrome.readOnly": "Settings are read-only in this environment",
	"chrome.overridden": "Overridden",
	"chrome.reset": "Reset",
	"section.memory.title": "Memory consolidation",
	"section.memory.description": "High frequency: distill sessions into CONTEXT.md and MEMORY.md",
	"section.autolearn.title": "Skill autolearn",
	"section.autolearn.description": "Low frequency: distill project skills, backtracking into session archives when evidence is missing",
	"field.memoryEnabled": "Enable automatic consolidation",
	"field.memoryEnabledHint": "When off, /memory update still works",
	"field.archiveEnabled": "Enable session archiving",
	"field.archiveEnabledHint": "When off, session.jsonl / session.md / INDEX.md are not written automatically; /session-log write still works",
	"field.consolidateTurns": "Turns before consolidating",
	"field.consolidateTurnsHint": "New user messages in this session since the last consolidation pass",
	"field.consolidateIntervalMs": "Minimum interval (ms)",
	"field.consolidateIntervalMsHint": "Shortest gap between two automatic consolidation passes",
	"field.forceDedupeMs": "Forced-pass dedupe window (ms)",
	"field.forceDedupeMsHint": "A repeated forced /memory update inside this window returns the previous result instead of calling the model again",
	"field.maxTokens": "Output cap (tokens)",
	"field.maxTokensHint": "Maximum tokens any auxiliary call (consolidation / autolearn) may generate",
	"field.maxOutputTokens": "Large output cap (tokens)",
	"field.maxOutputTokensHint": "Maximum tokens an auxiliary call that needs a longer answer may generate, default 32768",
	"field.maxMemoryChars": "Memory character cap",
	"field.maxMemoryCharsHint": "Character cap for MEMORY.md (4000–200000, default 40000); over the cap the document is cut on a line boundary and marked as truncated",
	"field.taskMode": "Task maintenance mode",
	"field.taskModeHint": "assisted (default: creating a task needs the explicit /context task <slug> new), delegated (a bare slug creates it, and 90 idle days archive it), or manual (never changes a status automatically)",
	"field.provider": "Provider",
	"field.providerHint": "Optional provider route override; shared by consolidation / autolearn",
	"field.model": "Model",
	"field.modelHint": "Optional model override; set together with provider and shared by all three features",
	"field.autolearnEnabled": "Enable automatic skill autolearn",
	"field.autolearnEnabledHint": "When off, /autolearn still works",
	"field.autolearnTurns": "Turns before autolearn",
	"field.autolearnTurnsHint": "Accumulated user messages since the last autolearn pass",
	"field.autolearnIntervalMs": "Minimum interval (ms)",
	"field.autolearnIntervalMsHint": "Shortest gap between two automatic autolearn passes; runs only when MEMORY/CONTEXT has new material",
	"section.handoff.title": "Automatic handoff",
	"section.handoff.description": "Continue in a fresh session as the context fills (no model call generates a summary); /handoff triggers it manually",
	"field.handoffEnabled": "Enable automatic handoff",
	"field.handoffEnabledHint": "When off, automatic handoff pauses; /handoff still works",
	"field.handoffThreshold": "Handoff threshold",
	"field.handoffThresholdHint": `\`auto\` (the default) derives the trigger from the window and keep budget; otherwise a share of the window (0.4, 40 or 40%, ${MIN_THRESHOLD_RATIO}–${MAX_THRESHOLD_RATIO}) or an absolute token count (400k). A count larger than the window is capped and said so in the receipt; at 0.8 and above dsh's own compaction (0.8) fires first`,
	"field.handoffBudgetSummaryTokens": "Summary target (report only)",
	"field.handoffBudgetSummaryTokensHint": `Read in adaptive mode only; it decides whether the receipt reports this target as fully applied. It never moves the trigger and calls no model (default ${DEFAULT_HANDOFF_SUMMARY_TOKENS})`,
	"field.handoffBudgetRecentTokens": HANDOFF_BUDGET_RECENT_LABEL.en,
	"field.handoffBudgetRecentTokensHint": "Recent conversation carried into the new session verbatim; 0 = no verbatim tail (default 20000). The user's last input is carried separately and is not affected by this value.",
	"field.handoffPendingQuestion": "Pending question handling",
	"field.handoffPendingQuestionHint": "defer (default, wait for the answer before handing off) or wait (hand off and carry the question into the continuation)",
	"field.handoffLang": "Handoff language",
	"field.handoffLangHint": "auto (default, follows the conversation), zh or en",
	"field.handoffRetireReplaced": "Archive the replaced session after a handoff",
	"field.handoffRetireReplacedHint": "On (default): after a successful handoff, stop whatever still runs in the replaced session and archive it (hidden from the sidebar; unarchive it under “All conversations (show archived)”). Off: the replaced session stays in the list and nothing in it is stopped, but it sorts above the continuation that replaced it.",
};

/**
 * The cause a failed settings save can be attributed to.
 *
 * The frame exposes one `failed` flag, so the card derives the cause from the document's revision
 * (see `ProjectContextSettingsCardController.saveFailure`); `unknown` is used when the revision is not
 * observable at all.
 */
export type SaveFailure = "conflict" | "rejected" | "unknown";

/**
 * The form frame's copy, read from this card's dictionary.
 *
 * The frame is the platform's `SettingsForm`, so its labels are the platform's five, not this
 * plugin's own chrome: a deployment that never composed the host half reads "not loaded" instead of
 * a form nothing would accept.
 * The failure line is the one label that varies by cause: the frame keeps one `failed` flag, so the
 * card hands it the sentence for the cause it could observe instead of a generic "try again".
 * @param t - the card's locale reader.
 * @param failure - the cause of the last failed save, when there was one.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: SettingsCardKey) => string, failure?: SaveFailure): SettingsFormLabels {
	return {
		unavailable: t("chrome.unavailable"),
		readOnly: t("chrome.readOnly"),
		saveFailed: t(
			failure === "conflict" ? "chrome.saveFailedConflict"
				: failure === "rejected" ? "chrome.saveFailedRejected"
					: "chrome.saveFailed",
		),
		save: t("chrome.save"),
		saving: t("chrome.saving"),
	};
}
