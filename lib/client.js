window.__ModuleLoader__.load({
	id: "dsh-project-context",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/project-handoff/marker.ts
var HANDOFF_TITLE_PREFIX = "\u21AA handoff \xB7 ";
function handoffSwitchDeferred(state) {
  return state !== void 0 && (state.phase !== "plain" || state.draft.trim().length > 0);
}
function noPlan() {
  return { seed: false, markSeen: [], deferred: false };
}
function planHandoffWatch(input) {
  if (typeof input.phase === "string" && input.phase !== "ready") return noPlan();
  if (!input.seeded) return { seed: true, markSeen: [], deferred: false };
  const markSeen = [];
  for (const row of input.rows) {
    if (row.origin === "subagent") {
      markSeen.push(row.id);
      continue;
    }
    if (row.cwd !== void 0 && input.currentCwd !== void 0 && row.cwd !== input.currentCwd) {
      markSeen.push(row.id);
      continue;
    }
    if (typeof row.title !== "string") continue;
    if (!row.title.startsWith(HANDOFF_TITLE_PREFIX)) {
      markSeen.push(row.id);
      continue;
    }
    if (input.current !== void 0 && handoffSwitchDeferred(input.composer)) {
      return { seed: false, markSeen, deferred: true };
    }
    return { seed: false, markSeen, open: row.id, deferred: false };
  }
  return { seed: false, markSeen, deferred: false };
}

// src/project-handoff/watch.ts
function inputSnapshot(conversation, id) {
  if (conversation === void 0 || id === void 0) return void 0;
  try {
    const state = conversation.input.shell(id).state.getSnapshot();
    if (typeof state !== "object" || state === null) return void 0;
    const { draft, phase } = state;
    if (typeof draft !== "string" || typeof phase !== "string") return void 0;
    return { draft, phase };
  } catch {
    return void 0;
  }
}
function watchHandoffSwitch(ctx) {
  const sessions = ctx.get("sessions");
  if (sessions === void 0) return () => void 0;
  const conversation = ctx.get("conversation");
  const seen = /* @__PURE__ */ new Set();
  let seeded = false;
  let composerOff;
  let composerFor;
  const stopComposerWatch = () => {
    composerOff?.();
    composerOff = void 0;
    composerFor = void 0;
  };
  const watchComposer = (current) => {
    if (composerFor === current && composerOff !== void 0) return;
    stopComposerWatch();
    if (conversation === void 0 || current === void 0) return;
    try {
      const state = conversation.input.shell(current).state;
      if (typeof state.subscribe !== "function") return;
      composerFor = current;
      composerOff = state.subscribe(() => {
        stopComposerWatch();
        scan();
      });
    } catch {
    }
  };
  const titleOf = (id) => {
    try {
      return sessions.binding(id)?.session.projections.faceOf("title").getSnapshot();
    } catch {
      return void 0;
    }
  };
  const scan = () => {
    const state = sessions.list.getSnapshot();
    const current = state.current === void 0 ? void 0 : String(state.current);
    const rows = [];
    for (const id of state.ids) {
      const key = String(id);
      if (seeded && seen.has(key)) continue;
      const summary = state.byId[key];
      rows.push({ id: key, origin: summary?.origin, cwd: summary?.cwd, title: titleOf(id) });
    }
    const plan = planHandoffWatch({
      phase: state.phase,
      seeded,
      current,
      currentCwd: current === void 0 ? void 0 : state.byId[current]?.cwd,
      composer: inputSnapshot(conversation, current),
      rows
    });
    if (plan.seed) {
      seeded = true;
      for (const row of rows) seen.add(row.id);
      stopComposerWatch();
      return;
    }
    for (const id of plan.markSeen) seen.add(id);
    if (plan.open !== void 0) {
      try {
        sessions.open(plan.open);
        seen.add(plan.open);
        stopComposerWatch();
      } catch {
      }
      return;
    }
    if (plan.deferred) watchComposer(current);
    else stopComposerWatch();
  };
  const unsubscribe = sessions.list.subscribe(scan);
  scan();
  return () => {
    unsubscribe();
    stopComposerWatch();
  };
}

// src/shared/setting-labels.ts
var HANDOFF_BUDGET_RECENT_LABEL = {
  zh: "\u4FDD\u7559\u6700\u8FD1\u5BF9\u8BDD\uFF08token\uFF09",
  en: "Recent tokens kept"
};

// client/locales.ts
var zh = {
  "card.title": "\u9879\u76EE\u4E0A\u4E0B\u6587",
  "card.description": "\u7EF4\u62A4\u9879\u76EE MEMORY.md / CONTEXT.md\u3001\u9879\u76EE\u6280\u80FD\u4E0E\u4F1A\u8BDD\u7D22\u5F15",
  "chrome.save": "\u4FDD\u5B58",
  "chrome.saving": "\u4FDD\u5B58\u4E2D\u2026",
  "chrome.saveFailed": "\u4FDD\u5B58\u672A\u751F\u6548\uFF0C\u8BF7\u91CD\u8BD5",
  "chrome.unavailable": "\u8BE5\u63D2\u4EF6\u5F53\u524D\u672A\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u914D\u7F6E",
  "chrome.invalidNumber": "\u8BF7\u586B\u6570\u5B57\uFF1B\u7559\u7A7A\u8868\u793A\u4F7F\u7528\u9ED8\u8BA4\u503C",
  "chrome.readOnly": "\u5F53\u524D\u73AF\u5883\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB",
  "chrome.overridden": "\u5DF2\u8986\u76D6",
  "chrome.reset": "\u91CD\u7F6E",
  "section.memory.title": "\u8BB0\u5FC6\u6574\u7406\uFF08consolidation\uFF09",
  "section.memory.description": "\u9AD8\u9891\uFF1A\u628A\u4F1A\u8BDD\u6C89\u6DC0\u4E3A CONTEXT.md \u4E0E MEMORY.md",
  "section.autolearn.title": "\u6280\u80FD\u6C89\u6DC0\uFF08autolearn\uFF09",
  "section.autolearn.description": "\u4F4E\u9891\uFF1A\u4ECE\u8BB0\u5FC6/\u4E0A\u4E0B\u6587\u63D0\u70BC\u9879\u76EE\u6280\u80FD\uFF0C\u7F3A\u8BC1\u636E\u65F6\u56DE\u8BFB\u4F1A\u8BDD\u5B58\u6863",
  "field.memoryEnabled": "\u542F\u7528\u81EA\u52A8\u6574\u7406",
  "field.memoryEnabledHint": "\u5173\u95ED\u540E\u4E0D\u518D\u81EA\u52A8\u6574\u7406\uFF1B/memory update \u4ECD\u53EF\u7528",
  "field.archiveEnabled": "\u542F\u7528\u4F1A\u8BDD\u5B58\u6863",
  "field.archiveEnabledHint": "\u5173\u95ED\u540E\u4E0D\u518D\u81EA\u52A8\u5199 session.jsonl / session.md / INDEX.md\uFF1B/session-log write \u4ECD\u53EF\u7528",
  "field.consolidateTurns": "\u89E6\u53D1\u8F6E\u6570",
  "field.consolidateTurnsHint": "\u672C\u4F1A\u8BDD\u7528\u6237\u6D88\u606F\u6570\u6BD4\u4E0A\u6B21\u6574\u7406\u589E\u52A0\u8BE5\u503C\u540E\u89E6\u53D1\uFF08\u4ECD\u53D7\u6700\u5C0F\u95F4\u9694\u9650\u5236\uFF09",
  "field.consolidateIntervalMs": "\u6700\u5C0F\u95F4\u9694\uFF08\u6BEB\u79D2\uFF09",
  "field.consolidateIntervalMsHint": "\u4E24\u6B21\u81EA\u52A8\u6574\u7406\u4E4B\u95F4\u7684\u6700\u77ED\u65F6\u95F4",
  "field.forceDedupeMs": "\u5F3A\u5236\u8C03\u7528\u53BB\u91CD\u7A97\u53E3\uFF08\u6BEB\u79D2\uFF09",
  "field.forceDedupeMsHint": "\u540C\u4E00\u7A97\u53E3\u5185\u91CD\u590D\u7684\u5F3A\u5236 /memory update \u76F4\u63A5\u8FD4\u56DE\u4E0A\u4E00\u6B21\u7ED3\u679C\uFF0C\u4E0D\u518D\u8C03\u7528\u6A21\u578B",
  "field.maxTokens": "\u8F93\u51FA\u4E0A\u9650\uFF08token\uFF09",
  "field.maxTokensHint": "\u8F85\u52A9\u6A21\u578B\u8C03\u7528\uFF08\u6574\u7406 / \u6280\u80FD / \u4EA4\u63A5\u6458\u8981\uFF09\u5141\u8BB8\u751F\u6210\u7684\u6700\u5927 token \u6570",
  "field.maxOutputTokens": "\u5927\u8F93\u51FA\u4E0A\u9650\uFF08token\uFF09",
  "field.maxOutputTokensHint": "\u9700\u8981\u66F4\u957F\u56DE\u7B54\u7684\u8F85\u52A9\u8C03\u7528\u5141\u8BB8\u751F\u6210\u7684\u6700\u5927 token \u6570\uFF0C\u9ED8\u8BA4 32768",
  "field.maxMemoryChars": "\u8BB0\u5FC6\u5B57\u7B26\u4E0A\u9650",
  "field.maxMemoryCharsHint": "MEMORY.md \u7684\u5B57\u7B26\u4E0A\u9650\uFF084000\u2013200000\uFF0C\u9ED8\u8BA4 40000\uFF09\uFF1B\u8D85\u51FA\u65F6\u6309\u6574\u884C\u88C1\u526A\u5E76\u8FFD\u52A0\u622A\u65AD\u6807\u8BB0",
  "field.provider": "Provider",
  "field.providerHint": "\u53EF\u9009\u7684 provider \u8DEF\u7531\u8986\u76D6\uFF1B\u8BB0\u5FC6\u6574\u7406 / \u6280\u80FD\u6C89\u6DC0 / \u4EA4\u63A5\u6458\u8981\u5171\u7528",
  "field.model": "Model",
  "field.modelHint": "\u53EF\u9009\u7684 model \u8986\u76D6\uFF0C\u9700\u4E0E provider \u540C\u65F6\u8BBE\u7F6E\uFF1B\u4E09\u9879\u529F\u80FD\u5171\u7528",
  "field.autolearnEnabled": "\u542F\u7528\u81EA\u52A8\u6280\u80FD\u6C89\u6DC0",
  "field.autolearnEnabledHint": "\u5173\u95ED\u540E\u4E0D\u518D\u81EA\u52A8\u6C89\u6DC0\uFF1B/autolearn \u4ECD\u53EF\u7528",
  "field.autolearnTurns": "\u89E6\u53D1\u8F6E\u6570",
  "field.autolearnTurnsHint": "\u81EA\u4E0A\u6B21\u6C89\u6DC0\u7D2F\u8BA1\u7684\u7528\u6237\u6D88\u606F\u6570\u8FBE\u5230\u8BE5\u503C\u540E\u89E6\u53D1\uFF08\u4E0E\u6700\u5C0F\u95F4\u9694\u53D6\u8F83\u5148\u6EE1\u8DB3\u8005\uFF09",
  "field.autolearnIntervalMs": "\u6700\u5C0F\u95F4\u9694\uFF08\u6BEB\u79D2\uFF09",
  "field.autolearnIntervalMsHint": "\u4E24\u6B21\u81EA\u52A8\u6C89\u6DC0\u4E4B\u95F4\u7684\u6700\u77ED\u65F6\u95F4\uFF1B\u4EC5\u5728 MEMORY/CONTEXT \u6709\u65B0\u5185\u5BB9\u65F6\u624D\u4F1A\u6267\u884C",
  "section.handoff.title": "\u81EA\u52A8\u4EA4\u63A5",
  "section.handoff.description": "\u4E0A\u4E0B\u6587\u63A5\u8FD1\u6A21\u578B\u4E0A\u9650\u65F6\u6458\u8981\u5E76\u53E6\u5F00\u65B0\u4F1A\u8BDD\u7EE7\u7EED\uFF1B/handoff \u53EF\u624B\u52A8\u89E6\u53D1",
  "field.handoffEnabled": "\u542F\u7528\u81EA\u52A8\u4EA4\u63A5",
  "field.handoffEnabledHint": "\u5173\u95ED\u540E\u81EA\u52A8\u4EA4\u63A5\u6682\u505C\uFF0C/handoff \u4ECD\u53EF\u7528",
  "field.handoffThresholdAuto": "\u81EA\u9002\u5E94\u9608\u503C",
  "field.handoffThresholdAutoHint": "\u5F00\u542F\u65F6\u6309\u4E0A\u4E0B\u6587\u7A97\u53E3\u4E0E\u4FDD\u7559\u91CF\u81EA\u52A8\u63A8\u5BFC\uFF1B\u5173\u95ED\u65F6\u7528\u4E0B\u9762\u7684\u56FA\u5B9A\u6BD4\u4F8B",
  "field.handoffThresholdRatio": "\u56FA\u5B9A\u9608\u503C\uFF08\u4E0A\u4E0B\u6587\u7A97\u53E3\u5360\u6BD4\uFF09",
  "field.handoffThresholdRatioHint": "\u4EC5\u81EA\u9002\u5E94\u5173\u95ED\u65F6\u751F\u6548\uFF1B0.1\u20130.95\uFF0C\u9ED8\u8BA4 0.4\uFF0C\u65E9\u4E8E dsh \u5185\u7F6E\u538B\u7F29\u7684 0.8",
  "field.handoffBudgetSummaryTokens": "\u5355\u6B21\u6458\u8981\u76EE\u6807\uFF08token\uFF09",
  "field.handoffBudgetSummaryTokensHint": "\u81EA\u9002\u5E94\u6A21\u5F0F\uFF1A\u6BCF\u6B21\u4EA4\u63A5\u6458\u8981\u79FB\u4EA4\u7684\u5BF9\u8BDD\u91CF\uFF0C\u9ED8\u8BA4 64000",
  "field.handoffBudgetRecentTokens": HANDOFF_BUDGET_RECENT_LABEL.zh,
  "field.handoffBudgetRecentTokensHint": "\u539F\u6837\u5E26\u5165\u65B0\u4F1A\u8BDD\u7684\u6700\u8FD1\u5BF9\u8BDD\uFF0C0 \u8868\u793A\u4E0D\u9010\u5B57\u5E26\u5165\u5BF9\u8BDD\u5C3E\u6599\uFF08\u9ED8\u8BA4 20000\uFF1B\u7528\u6237\u6700\u540E\u4E00\u6B21\u8F93\u5165\u4E0D\u53D7\u8BE5\u503C\u5F71\u54CD\uFF0C\u59CB\u7EC8\u5355\u72EC\u5E26\u5165\uFF09",
  "field.handoffThinking": "\u6458\u8981\u601D\u8003\u7EA7\u522B",
  "field.handoffThinkingHint": "off\uFF08\u9ED8\u8BA4\uFF0C\u907F\u514D\u601D\u8003\u4E0E\u7B54\u6848\u5171\u4EAB\u8F93\u51FA\u4E0A\u9650\uFF09\u6216 session",
  "field.handoffPendingQuestion": "\u672A\u7B54\u95EE\u9898\u7684\u5904\u7406",
  "field.handoffPendingQuestionHint": "defer\uFF08\u9ED8\u8BA4\uFF0C\u7B49\u7528\u6237\u56DE\u7B54\u540E\u518D\u4EA4\u63A5\uFF09\u6216 wait\uFF08\u7EE7\u7EED\u4EA4\u63A5\uFF0C\u628A\u95EE\u9898\u5E26\u8FDB\u65B0\u4F1A\u8BDD\uFF09",
  "field.handoffLang": "\u4EA4\u63A5\u8BED\u8A00",
  "field.handoffLangHint": "auto\uFF08\u9ED8\u8BA4\uFF0C\u8DDF\u968F\u4F1A\u8BDD\u8BED\u8A00\uFF09\u3001zh \u6216 en\uFF1B\u6458\u8981\u6807\u9898\u4F1A\u4E00\u5E76\u672C\u5730\u5316"
};
var en = {
  "card.title": "Project Context",
  "card.description": "Maintain project MEMORY.md / CONTEXT.md, skills and the session index",
  "chrome.save": "Save",
  "chrome.saving": "Saving\u2026",
  "chrome.saveFailed": "Save did not land; try again",
  "chrome.unavailable": "This plugin is not loaded, so it cannot be configured right now",
  "chrome.invalidNumber": "Enter a number, or leave blank to use the default",
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
  "field.maxTokensHint": "Maximum tokens any auxiliary call (consolidation / autolearn / handoff summary) may generate",
  "field.maxOutputTokens": "Large output cap (tokens)",
  "field.maxOutputTokensHint": "Maximum tokens an auxiliary call that needs a longer answer may generate, default 32768",
  "field.maxMemoryChars": "Memory character cap",
  "field.maxMemoryCharsHint": "Character cap for MEMORY.md (4000\u2013200000, default 40000); over the cap the document is cut on a line boundary and marked as truncated",
  "field.provider": "Provider",
  "field.providerHint": "Optional provider route override; shared by consolidation / autolearn / handoff summary",
  "field.model": "Model",
  "field.modelHint": "Optional model override; set together with provider and shared by all three features",
  "field.autolearnEnabled": "Enable automatic skill autolearn",
  "field.autolearnEnabledHint": "When off, /autolearn still works",
  "field.autolearnTurns": "Turns before autolearn",
  "field.autolearnTurnsHint": "Accumulated user messages since the last autolearn pass",
  "field.autolearnIntervalMs": "Minimum interval (ms)",
  "field.autolearnIntervalMsHint": "Shortest gap between two automatic autolearn passes; runs only when MEMORY/CONTEXT has new material",
  "section.handoff.title": "Automatic handoff",
  "section.handoff.description": "Summarize and continue in a fresh session as the context fills; /handoff triggers it manually",
  "field.handoffEnabled": "Enable automatic handoff",
  "field.handoffEnabledHint": "When off, automatic handoff pauses; /handoff still works",
  "field.handoffThresholdAuto": "Adaptive threshold",
  "field.handoffThresholdAutoHint": "Derive the trigger from the window and keep budget; off uses the fixed ratio below",
  "field.handoffThresholdRatio": "Fixed threshold (share of window)",
  "field.handoffThresholdRatioHint": "Only used when adaptive is off; 0.1\u20130.95, default 0.4, before dsh compaction's 0.8",
  "field.handoffBudgetSummaryTokens": "Tokens per summary",
  "field.handoffBudgetSummaryTokensHint": "Adaptive mode: conversation tokens handed to each summary, default 64000",
  "field.handoffBudgetRecentTokens": HANDOFF_BUDGET_RECENT_LABEL.en,
  "field.handoffBudgetRecentTokensHint": "Recent conversation carried into the new session verbatim; 0 = no verbatim tail (default 20000). The user's last input is carried separately and is not affected by this value.",
  "field.handoffThinking": "Summary thinking level",
  "field.handoffThinkingHint": "off (default, avoids sharing the output cap with thinking) or session",
  "field.handoffPendingQuestion": "Pending question handling",
  "field.handoffPendingQuestionHint": "defer (default, wait for the answer before handing off) or wait (hand off and carry the question into the continuation)",
  "field.handoffLang": "Handoff language",
  "field.handoffLangHint": "auto (default, follows the conversation), zh or en; summary headings are localized too"
};
function formLabels(t) {
  return {
    unavailable: t("chrome.unavailable"),
    readOnly: t("chrome.readOnly"),
    saveFailed: t("chrome.saveFailed"),
    save: t("chrome.save"),
    saving: t("chrome.saving")
  };
}

// client/card-fields.ts
var SECTIONS = [
  {
    titleKey: "section.memory.title",
    descriptionKey: "section.memory.description",
    rows: [
      { key: "archiveEnabled", kind: "boolean" },
      { key: "memoryEnabled", kind: "boolean" },
      { key: "consolidateTurns", kind: "number" },
      { key: "consolidateIntervalMs", kind: "number" },
      { key: "forceDedupeMs", kind: "number" },
      // Shared auxiliary route: consolidation, autolearn and the handoff summary all use it.
      { key: "maxTokens", kind: "number" },
      { key: "maxOutputTokens", kind: "number" },
      { key: "maxMemoryChars", kind: "number" },
      { key: "provider", kind: "text" },
      { key: "model", kind: "text" }
    ]
  },
  {
    titleKey: "section.autolearn.title",
    descriptionKey: "section.autolearn.description",
    rows: [
      { key: "autolearnEnabled", kind: "boolean" },
      { key: "autolearnTurns", kind: "number" },
      { key: "autolearnIntervalMs", kind: "number" }
    ]
  },
  {
    titleKey: "section.handoff.title",
    descriptionKey: "section.handoff.description",
    rows: [
      { key: "handoffEnabled", kind: "boolean" },
      { key: "handoffThresholdAuto", kind: "boolean" },
      { key: "handoffThresholdRatio", kind: "number" },
      { key: "handoffBudgetSummaryTokens", kind: "number" },
      { key: "handoffBudgetRecentTokens", kind: "number" },
      { key: "handoffThinking", kind: "union", options: ["off", "session"] },
      { key: "handoffPendingQuestion", kind: "union", options: ["defer", "wait"] },
      { key: "handoffLang", kind: "union", options: ["auto", "zh", "en"] }
    ]
  }
];
var ROWS = SECTIONS.flatMap((section) => section.rows);
function labelKey(key) {
  return `field.${key}`;
}
function hintKey(key) {
  return `field.${key}Hint`;
}
function booleanField(field) {
  return {
    field,
    format: (value) => value === true ? "true" : "false",
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === "true") return { kind: "set", value: true };
      if (trimmed === "false") return { kind: "set", value: false };
      return trimmed === "" ? { kind: "clear" } : void 0;
    }
  };
}
function unionField(field, options) {
  return {
    field,
    format: (value) => typeof value === "string" && options.includes(value) ? value : "",
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") return { kind: "clear" };
      return options.includes(trimmed) ? { kind: "set", value: trimmed } : void 0;
    }
  };
}

// client/settings-card.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// client/styles.ts
var css = `
.dshPcSection { margin-top: 18px; }
.dshPcSection:first-child { margin-top: 4px; }
.dshPcSectionTitle {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.dshPcSectionDescription { margin: 2px 0 6px; font-size: 12px; }
.dshPcRow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 10px 0; }
.dshPcRowHead { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
.dshPcRowLabel { font-size: 13px; font-weight: 500; }
.dshPcRowControl { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.dshPcRowText { flex: 1 1 100%; min-width: 0; margin: 0; font-size: 12px; }
.dshPcPills { display: inline-flex; align-items: center; gap: 6px; }
`;
var STYLE_ID = "dsh-project-context-card-styles";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

// client/settings-card.tsx
var import_jsx_runtime = require("react/jsx-runtime");
injectStyles();
var SPEC_BUILDERS = {
  number: (row) => (0, import_dsh_client_ui_primitives.settingsNumberField)(row.key),
  text: (row) => (0, import_dsh_client_ui_primitives.settingsTextField)(row.key),
  boolean: (row) => booleanField(row.key),
  union: (row) => unionField(row.key, row.options ?? [])
};
var ProjectContextSettingsCardController = class {
  /** @param scope - the bound configuration form for the `project-context` namespace. */
  constructor(scope) {
    __publicField(this, "form");
    __publicField(this, "store");
    this.form = new import_dsh_client_ui_primitives.SettingsFormModel(scope, ROWS.map((row) => SPEC_BUILDERS[row.kind](row)));
    this.store = this.form.bind(() => this.projection());
  }
  // One loop over the same table the specs and the rows come from: a key cannot be projected
  // twice, or be missing from the projection, without the table itself changing.
  projection() {
    const fields = {};
    for (const row of ROWS) fields[row.key] = this.form.field(row.key);
    return { ...this.form.shell(), fields };
  }
  /** Build the face the card's slot registration injects. */
  inject() {
    return { hooks: { projectContextSettingsCard: this.store }, ...this.form.actions() };
  }
  /** Release the form's scope subscription; the owning fiber calls this on unload. */
  dispose() {
    this.form.dispose();
  }
};
function Override(props) {
  if (!props.overridden) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "neutral", children: props.overriddenLabel }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", disabled: props.disabled, onClick: props.onReset, children: props.resetLabel })
  ] });
}
function BooleanRow(props) {
  const { copy, state } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshPcRow", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshPcRowHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshPcRowLabel", children: copy.label }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Override,
        {
          overridden: state.overridden,
          disabled: copy.disabled,
          overriddenLabel: copy.overriddenLabel,
          resetLabel: copy.resetLabel,
          onReset: props.onReset
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshPcRowControl", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Switch,
      {
        checked: state.text === "true",
        label: copy.label,
        disabled: copy.disabled,
        onChange: (next) => {
          props.onEdit(next ? "true" : "false");
        }
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dshPcRowText", children: copy.hint })
  ] });
}
function UnionRow(props) {
  const { copy, state } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshPcRow", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshPcRowHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dshPcRowLabel", children: copy.label }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Override,
        {
          overridden: state.overridden,
          disabled: copy.disabled,
          overriddenLabel: copy.overriddenLabel,
          resetLabel: copy.resetLabel,
          onReset: props.onReset
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshPcRowControl dshPcPills", children: (props.row.options ?? []).map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Pill,
      {
        active: state.text === option,
        disabled: copy.disabled,
        onClick: () => {
          props.onEdit(option);
        },
        children: option
      },
      option
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dshPcRowText", children: copy.hint })
  ] });
}
function Row(props) {
  const { row, state, copy } = props;
  if (row.kind === "boolean") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BooleanRow, { ...props });
  if (row.kind === "union") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UnionRow, { ...props });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives.SettingsValueField,
    {
      id: `dsh-pc-${row.key}`,
      label: copy.label,
      hint: copy.hint,
      overriddenLabel: copy.overriddenLabel,
      resetLabel: copy.resetLabel,
      invalidLabel: copy.invalidLabel,
      ...row.kind === "number" ? { numeric: true } : {},
      disabled: copy.disabled,
      ...state,
      onEdit: props.onEdit,
      onReset: props.onReset
    }
  );
}
function ProjectContextSettingsCard(props) {
  const { t } = props;
  const state = props.useProjectContextSettingsCard((snapshot) => snapshot);
  if (props.view === "summary") return t("card.description");
  const copy = (row) => ({
    label: t(labelKey(row.key)),
    hint: t(hintKey(row.key)),
    overriddenLabel: t("chrome.overridden"),
    resetLabel: t("chrome.reset"),
    invalidLabel: t("chrome.invalidNumber"),
    disabled: !state.writable
  });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.SettingsForm, { labels: formLabels(t), state, onSave: props.save, onDiscard: props.discard, children: SECTIONS.map((section) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dshPcSection", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "dshPcSectionTitle", children: t(section.titleKey) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dshPcSectionDescription", children: t(section.descriptionKey) }),
    section.rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      Row,
      {
        row,
        state: state.fields[row.key],
        copy: copy(row),
        onEdit: (text) => {
          props.edit(row.key, text);
        },
        onReset: () => {
          props.resetField(row.key);
        }
      },
      row.key
    ))
  ] }, section.titleKey)) });
}

// client/index.ts
var NS = "project-context";
var CARD_SLOT = "plugins.bundle.config";
var BUNDLE_KEY = "dsh-project-context";
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "project-context: dictionaries");
  ctx.inject(["configForms"], (formsCtx) => {
    const controller = new ProjectContextSettingsCardController(
      formsCtx.configForms.get(NS)
    );
    formsCtx.effect(() => () => controller.dispose(), "project-context: settings card");
    formsCtx.effect(
      () => formsCtx.configForms.whileServed(
        [NS],
        () => formsCtx.slots.inject(
          CARD_SLOT,
          () => formsCtx.slots.register(
            {
              name: CARD_SLOT,
              key: BUNDLE_KEY,
              locale: NS,
              inject: () => controller.inject()
            },
            ProjectContextSettingsCard
          )
        )
      ),
      "project-context: settings page"
    );
  });
  ctx.inject(["sessions"], (sessionsCtx) => {
    sessionsCtx.effect(() => watchHandoffSwitch(sessionsCtx), "project-context: handoff switch");
  });
}
		return module.exports;
	}
});
