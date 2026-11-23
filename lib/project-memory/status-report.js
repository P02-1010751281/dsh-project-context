/**
 * The `/memory` status **core**: one report DTO in, one receipt string out.
 *
 * Nothing here touches the harness or the disk. How many lines the journal has, how many backups sit
 * next to the render, how many sessions are archived — those arrive already measured from the sibling
 * `status-source.ts`, the one file that knows the `.agents/memory` layout. A receipt is therefore a pure
 * function of what was measured, and a wording change can never disagree with a count.
 *
 * Two rules the wording enforces:
 *
 * - A value we could not measure is a *named* absence (`unknown`, `none yet`, `unparseable`), never a
 *   `0`: "no backups" and "could not list the directory" are different facts, and this repository
 *   treats a wrong cause as worse than a named gap.
 * - Nothing claims what the last consolidation did. That outcome is not persisted anywhere — not in a
 *   state file, not in a journal record — so the receipt says so instead of inferring it from an mtime
 *   or a size. A receipt that guessed would be wrong the first time two passes ran close together.
 *
 * Section counts come from `sectionsFromMarkdown`, the same conservative parser the write path uses:
 * a document it cannot read with certainty is reported as *unparseable*, not as four empty sections,
 * because "0 entries" would read as "this memory is empty" when the truth is "this is not our shape".
 */
import { counted, pick } from "../shared/language.js";
import { isMemoryTruncated } from "./document.js";
import { MEMORY_SECTIONS } from "./memory-schema.js";
import { sectionsFromMarkdown } from "./sections.js";
import { stalenessClause } from "./staleness.js";
/** The four sections in document order, as headings to display and the parser keys behind them. */
const COUNTED_SECTIONS = MEMORY_SECTIONS.map((section) => ({
    heading: section.heading,
    key: section.heading.toLowerCase(),
}));
/** `1 backup` / `2 backups` / `2 个备份`: a receipt reads as prose, so the count agrees with its noun. */
function plural(language, count, singular, many, zh) {
    return `${count} ${counted(language, count, singular, many, zh)}`;
}
/** `138 entries (Project 12, Invariants 64, Pitfalls 44, Index 18)`, or a named refusal to count. */
function sectionsClause(document, language = "en") {
    const parsed = sectionsFromMarkdown(document);
    if (parsed === undefined) {
        return pick(language, "段落不可解析（不是纯四段项目符号文档 —— 条目计数保留，绝不报 0）", "sections unparseable (not a plain four-section bullet document — entry counts withheld, not reported as 0)");
    }
    const counts = COUNTED_SECTIONS.map(({ heading, key }) => `${heading} ${parsed[key].length}`);
    const total = COUNTED_SECTIONS.reduce((sum, { key }) => sum + parsed[key].length, 0);
    // The line's own label is part of the clause: leaving it to the caller produced `sections: 138 个条目`
    // — the mixed line this batch exists to remove.
    return pick(language, `段落：${total} 个条目（${counts.join("、")}）`, `sections: ${plural(language, total, "entry", "entries", "个条目")} (${counts.join(", ")})`);
}
/** `journal <path> 12 line(s) / 900 byte(s)`, with absence and unreadability named as themselves. */
function journalClause(path, facts, language = "en") {
    if (facts.kind === "absent")
        return pick(language, `日志 ${path} 尚未生成`, `journal ${path} none yet`);
    if (facts.kind === "unreadable")
        return pick(language, `日志 ${path} 无法读取`, `journal ${path} unreadable`);
    return pick(language, `日志 ${path} ${plural(language, facts.lines, "line", "lines", "行")} / ${plural(language, facts.bytes, "byte", "bytes", "字节")}`, `journal ${path} ${plural(language, facts.lines, "line", "lines", "行")} / ${plural(language, facts.bytes, "byte", "bytes", "字节")}`);
}
/**
 * The `/memory` status receipt.
 *
 * The reply distinguishes the states a silent fold would otherwise hide: a torn journal line, a source
 * that exists but cannot be read, and a stored reply from the old bug. It also reports the character
 * cap, which is the one degraded state the document itself cannot surface to the user: a marker records
 * that the document was capped *at some point* (it is carried forward), while `cappedDroppedChars`
 * describes what **this** read's cap kept back — including on the no-journal read, which clips without
 * writing a marker at all. Either one is enough to warn; a memory that lost a third of itself must not
 * read as perfectly healthy, or every later append lands past the cap and is dropped on write.
 *
 * Layout is load-bearing, not cosmetic: the client renders this reply as a collapsed command row whose
 * summary is the whole text flattened onto one `nowrap` line and clipped, so the visible prefix — the
 * start of the first line — is what the reader gets until they expand it. That is why the measurements
 * lead and the paths do not; see the healthy branch for the mechanism.
 * @param report - the loaded document, its flags, and the file facts the adapter measured.
 * @returns the command result.
 */
export function formatMemoryStatus(report, language = "en") {
    // One line per fact group. The receipt used to be a single `·`-joined sentence; once the staleness
    // verdict joined it, that sentence outgrew a terminal line, so the groups are separated by newlines
    // while the `·` separator survives *inside* a line where it still helps scanning the numbers.
    //
    // A marker is history, not a measurement. `isMemoryTruncated` only reports that the document still
    // carries the line an *earlier* cap wrote — the marker is carried forward by every later render —
    // so a memory that was capped once and has since been rewritten short still reads as "truncated".
    // What a pass actually refuses on is this read's hidden-character count (`readCapHidden` in
    // `consolidate.ts`), which is `cappedDroppedChars`. Warning that "this read is cut" off the marker
    // alone tells the user a wrong cause: nothing was hidden from them.
    const capped = report.cappedDroppedChars > 0
        ? pick(language, `警告：MEMORY.md 达到 ${report.maxChars} 字符上限 —— 本次读取被切，整理 pass 会拒绝重写它（状态 read-capped-refused），超过上限追加的内容会在写入时被丢弃；请调大 maxMemoryChars 或缩短文档。`, `Warning: MEMORY.md is at the ${report.maxChars}-character cap — this read is cut, so a consolidation pass refuses to rewrite it (status read-capped-refused), and anything appended past the cap is dropped on write; raise maxMemoryChars or shorten the document.`)
        : isMemoryTruncated(report.document)
            ? pick(language, "说明：MEMORY.md 仍带着早前上限留下的标记，但本次读取没有丢任何内容 —— 文档此后被改短过；下一次整理 pass 会重写它并清掉标记。", "Note: MEMORY.md still carries the marker of an earlier cap, but nothing was dropped from this read — the document was rewritten short since; the next consolidation pass rewrites it and clears the marker.")
            : "";
    // `trim()` decides only whether there is a document; the size printed is the document's own length,
    // never a normalized count (a trimmed length would quietly disagree with the file the user opens).
    const document = report.document;
    const empty = document.trim() === "";
    const lines = [];
    let primary;
    if (report.unreadable) {
        const hint = report.source.endsWith("memory.jsonl")
            ? pick(language, "删掉它以便从 MEMORY.md 重建，或从 memory-log-*.jsonl 恢复", "Delete it to rebuild from MEMORY.md, or restore from memory-log-*.jsonl")
            : pick(language, "检查它的权限", "check its permissions");
        primary = pick(language, `记忆：存在但无法读取 —— ${report.source}；${hint}。`, `Memory: exists but cannot be read — ${report.source}; ${hint}.`);
    }
    else if (report.damaged > 0) {
        primary = pick(language, `记忆：${report.journalPath}（跳过 ${report.damaged} 行不可用记录；见 .agents/memory/errors.log）。`, `Memory: ${report.journalPath} (${report.damaged} unusable line(s) skipped; see .agents/memory/errors.log).`);
    }
    else if (report.poisoned) {
        primary = pick(language, `记忆：${report.source}（以旧缺陷留下的原始 JSON 存储；下一次整理会先备份再改写成 Markdown）。`, `Memory: ${report.source} (stored as raw JSON from the old bug; the next consolidation backs it up and rewrites it as Markdown).`);
    }
    else if (empty) {
        primary = pick(language, `记忆：尚未生成 —— ${report.expectedPath}`, `Memory: none yet — ${report.expectedPath}`);
    }
    else {
        // The measurements lead, not the source path. The client renders a command receipt as a
        // collapsed row: `.summary` is `white-space: nowrap` with an ellipsis, and the full text is a
        // `<pre>` behind a disclosure that only exists when the text contains a newline — so a
        // single-line receipt can never be expanded, and the visible prefix of the flattened text is
        // all a reader sees without opening it. An absolute path there pushed the size, the section
        // counts and `stale N` past the clip.
        primary = pick(language, "记忆：", "Memory:");
    }
    // A document we could not load has no size or sections to report; saying `0 chars` for it would be
    // the same wrong cause the unreadable wording above refuses to tell.
    if (!report.unreadable && !empty) {
        const measurement = pick(language, `${document.length}/${report.maxChars} 字符（${Math.round((document.length / report.maxChars) * 100)}%）`, `${document.length}/${report.maxChars} chars (${Math.round((document.length / report.maxChars) * 100)}%)`);
        // Every other branch's `primary` is a finished sentence naming the broken thing; only the healthy
        // branch is a bare label waiting for its numbers.
        lines.push(primary.endsWith(":") || primary.endsWith("：") ? `${primary} ${measurement}` : `${primary} · ${measurement}`);
        // The section breakdown is its own line. On one line it pushed the folded summary past the
        // client's clip, and the size above is the number a reader acts on.
        lines.push(sectionsClause(report.document, language));
        // Only a document we could parse has entries to judge; the field is absent when nothing measured.
        if (report.staleness !== undefined)
            lines.push(stalenessClause(report.staleness, language));
    }
    else {
        lines.push(primary);
    }
    if (capped !== "")
        lines.push(capped);
    // The source gets its own line, and only when it is not the journal itself (the journal line names
    // that file already). Keeping the journal line-leading preserves its anchored shape for both the
    // tests and a reader scanning for `journal …`.
    const source = !report.unreadable && !empty && report.source !== report.journalPath
        ? pick(language, `来源 ${report.source}`, `source ${report.source}`)
        : "";
    if (source !== "")
        lines.push(source);
    lines.push(journalClause(report.journalPath, report.files.journal, language));
    lines.push([
        report.files.backups === undefined
            ? pick(language, "备份数未知", "backups unknown")
            : plural(language, report.files.backups, "backup", "backups", "个备份"),
        report.files.archivedSessions === undefined
            ? pick(language, "归档会话数未知", "archived sessions unknown")
            : plural(language, report.files.archivedSessions, "archived session", "archived sessions", "个归档会话"),
        report.files.errorLogLines === undefined
            ? pick(language, "errors.log 未知", "errors.log unknown")
            : pick(language, `errors.log ${report.files.errorLogLines} 行`, `errors.log ${plural(language, report.files.errorLogLines, "line", "lines", "行")}`),
    ].join(" · "));
    lines.push(pick(language, "没有上一轮结果（整理结果不持久化）", "no last-pass result (consolidation outcomes are not persisted)"));
    // Derived, not authoritative: the journal is append-only truth and this document is a projection of
    // it. Borrowed from AOCI's `derived=true / authoritative=false` marker — the distinction is the one
    // a reader needs before treating MEMORY.md as the record. Only when the loaded document really came
    // from the journal: a journal file can exist and still lose (`loadMemory` falls back to MEMORY.md
    // when the journal has no records, and adopts a newer render after an outside edit), and in both
    // cases MEMORY.md is the source the receipt names — telling the reader "the authority is the
    // journal" there would be a wrong cause.
    if (!report.unreadable && !empty && report.source === report.journalPath) {
        lines.push(pick(language, "派生视图：MEMORY.md 是投影，权威是日志", "derived view: MEMORY.md is a projection, the authority is the journal"));
    }
    return { kind: report.unreadable ? "error" : "success", text: lines.join("\n") };
}
