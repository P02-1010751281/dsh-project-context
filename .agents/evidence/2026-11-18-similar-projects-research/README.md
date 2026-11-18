# 调研证据包：同类系统与组件级相似物（2026-11-18）

本目录是 [`docs/research/2026-11-18-similar-projects.md`](../../../docs/research/2026-11-18-similar-projects.md)
的原始证据，冻结保存、不回改。目标是让报告里每一条关于外部系统的机制断言都能被下一个人
按 URL 和 SHA-256 复验，而不是只剩一段转述。

## 目录

| 路径 | 是什么 |
|---|---|
| `sources/` | 抓取到的原始文件（README、官方文档、规范、论文页）；`.txt` 是由同 slug 的 `.html` 本地转换的可读副本，不是独立证据 |
| `api/search-*.json` | GitHub Search API 的原始响应（查询式、命中总数、星数/许可/推送时间都在里面） |
| `api/repo-*.json` | 单个仓库的 GitHub API 元数据 |
| `api/arxiv/*.xml` | arXiv API 的原始 Atom 响应（标题、作者、日期、摘要） |
| `manifest.tsv` | 每个成功抓取的原始文件：时间、slug、HTTP、字节数、完整 SHA-256、URL |
| `failures.tsv` | 被拒绝或 404 的抓取（保留失败本身，避免"没抓到"被误写成"不存在"） |
| `sources.md` | 由 `manifest.tsv` 生成的证据清单（前 16 位哈希，完整值仍以 manifest 为准） |
| `local/siblings-snapshot.txt` | 本机三个同族仓库的 HEAD/分支/文件数/README 哈希快照 |
| `fetch.sh` / `html2txt.py` | 抓取与 HTML→文本转换脚本，便于复现 |
| `list-*.tsv` | 每次抓取的输入清单（slug、URL、扩展名） |

## 抓取方式与证据等级

- README 与规范优先取 `raw.githubusercontent.com/<repo>/HEAD/...`，是仓库当前 HEAD 的原文。
- 官方文档取页面 HTML；Mintlify 站点（Claude Code Docs）优先取 `.md` 版本，避免 JS 噪声。
- 有 4 个页面直连失败（`failures.tsv`：两个 404、两个 403）。其中 Codex 的 AGENTS.md/配置样例、
  GitHub Copilot 指令文档改由 `r.jina.ai` 的文本代理取得（`list-proxy.tsv`），manifest 里记录的是
  代理 URL。**这类文本代理只保证"当时读到的文本"，不等于原始 HTML 字节**，引用具体数字时报告会
  单独标注。
- 论文用 arXiv API（`export.arxiv.org`）取 Atom 元数据与摘要；不是 PDF 全文，报告只使用摘要级
  可核实的结论，不把论文实验细节写成定论。
- GitHub 星数是 2026-11-18 的 API 快照，只用于说明生态规模，不作为质量判据；本仓库在私有
  Forgejo 上，没有可比的星数。

## 选择标准（为什么是这些）

纳入的是满足至少一条的系统：

1. 与本项目同宿主（DSH 插件），直接争夺同一问题；
2. 同族仓库（pi / codex），同一套数据流的另外两个宿主实现；
3. 跨宿主 coding-agent 记忆产品，四阶段里至少覆盖两段；
4. 宿主原生能力（Claude Code / Codex / Gemini / Cursor / Windsurf / Copilot / aider / OpenHands），
   决定"用户为什么可能不装插件"；
5. 记忆基础设施（Letta / mem0 / Zep / Cognee / MemOS / MemU / memsearch），提供组件级机制；
6. 研究原型（MemGPT / MemoryBank / A-MEM / ACE / ReasoningBank / Voyager / AWM / ExpeL /
   Dynamic Cheatsheet / ACON / LongMemEval / Context Rot），解释机制为何有效。

未纳入：纯向量数据库、通用 RAG 框架、与"项目级持久上下文"无关的聊天记忆玩具。长尾项目在
报告第 3、5 节以表格列出，不逐个抓 README。

## 关键断言 → 证据映射

| 报告断言 | 证据文件 |
|---|---|
| claude-mem 用 9 类 hook、SQLite+Chroma、观察/摘要、渐进索引 | `sources/claude-mem.md`（How It Works / How it fits together） |
| OpenViking 把知识/记忆/技能做成 `viking://` 文件系统，L0/L1/L2 | `sources/openviking.md`（What is OpenViking / Why） |
| Trail-Code 的 learnings 是提交进仓库的 Markdown，skills 尚未落地 | `sources/trail-code.md`（How it works / Learnings and skills） |
| agentmemory 四层记忆、12 hooks、17 skills、handoff | `sources/agentmemory.md`（architecture / skills / tools 表） |
| ai-memory 的 capture→consolidate→recall→handoff 与 wiki 页 | `sources/ai-memory.md`（How it works） |
| deja-vu 读 48 个 agent 的本地会话、`handoff --to`、repo memory | `sources/deja-vu.md`（Memory in the repository / CLI） |
| Continuous-Claude 从 thinking block 抽记忆、continuity ledger | `sources/continuous-claude.md`（Memory System / Continuity System） |
| Cline Memory Bank 六个文件、手动 update | `sources/cline-memory-bank.txt`（Core Files / Managing Context Windows） |
| ConPort 每 workspace 一个 SQLite + 向量 | `sources/context-portal.md`（What is ConPort） |
| Letta 的 MemFS、`/init`、`/doctor`、dreaming 后台整理 | `sources/letta-sleep-time.txt`（Memory & dreaming） |
| mem0 的 ADD-only 抽取 + 实体链接（厂商自述） | `sources/mem0.md`（What's new / benchmarks） |
| Zep/Graphiti 的时序知识图谱 | `sources/graphiti.md`、`sources/zep-concepts.txt` |
| MemOS 的 L1/L2/L3 技能演化 | `sources/memos.md`（local plugin 段落） |
| MemU 的自动技能抽取、agent 决策、MemoryService 不调 LLM | `sources/memu.md`（Automatic skill extraction） |
| Claude Code auto memory 的 200 行/25KB 上限、topic 文件、时间戳 | `sources/cc-memory-md.md`（auto memory 段） |
| Claude Code 压缩保留启动内容、最近 5 个文件、skill 正文 | `sources/cc-context-window-md.md`（What survives compaction） |
| Codex 的 `model_auto_compact_token_limit` 与 turn-end compaction | `sources/codex-config-sample.md` |
| Codex AGENTS.md 的全局/项目分层 | `sources/codex-agents-md.md` |
| Gemini CLI 三层 GEMINI.md、模型直接编辑 | `sources/gemini-memory.md` |
| Cursor 文档当前只给 Rules（未检出自动记忆页） | `sources/cursor-memories.txt` |
| Windsurf 文档已切到 Devin Local 的 rules/skills/hooks | `sources/windsurf-memories.txt` |
| GitHub Copilot 仓库级自定义指令 | `sources/copilot-instructions.md` |
| aider 的 CONVENTIONS.md + `/read` | `sources/aider-conventions-doc.txt` |
| OpenHands 的 condenser 保留首尾、摘要中段 | `sources/openhands-condenser.txt` |
| Agent Skills 的名称/描述常驻 + 正文按需的三级披露 | `sources/agentskills-spec.txt`、`sources/anthropic-skills-post.txt` |
| 长上下文退化（18 个模型） | `sources/chroma-context-rot.txt` |
| Anthropic 的 compaction / structured notes / subagents | `sources/anthropic-context-eng.txt` |
| 论文机制（reflection / 遗忘曲线 / Zettelkasten / playbook / 经验蒸馏 / 压缩） | `api/arxiv/*.xml`（摘要） |
| DSH 同宿主插件的机制 | `sources/dsh-*.md`、`sources/memtrace.md`、`sources/mneme.md`、`sources/memsearch.md` |
| 官方 Memory MCP 的本地 JSON 知识图谱 | `sources/memory-mcp.md` |

## 复验

```bash
cd .agents/evidence/2026-11-18-similar-projects-research
# 逐行核对：文件还在、字节数与哈希一致
while IFS=$'\t' read -r t slug code size sha url; do
  [ -f "sources/$slug" ] || ls sources/"$slug".* >/dev/null 2>&1 || { echo "MISSING $slug"; continue; }
  f=$(ls sources/"$slug".* | head -1)
  printf '%s  %s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$sha" "$slug"
done < manifest.tsv | awk '$1!=$2{print "MISMATCH",$3}'
```

注意：`sources.md` 只展示哈希前缀；`manifest.tsv` 才是完整值。`sources/` 里的 `.txt` 是从
`.html` 派生的副本，不在 manifest 里，复验应针对原始扩展名。

## 已知边界

- 只做了文档/源码阅读，没有逐个安装试用；"是否真的这样跑"属于厂商自述或 README 承诺。
- 官方文档站点在 2026 年变动频繁（Cursor 的 memories 入口现在返回 Rules，Windsurf 文档切到
  Devin Local，Codex 文档迁到 learn.chatgpt.com）；报告里的链接与判断都带抓取日期。
- 星数、下载量、benchmark 数字均照抄来源，未独立复现。
- 中文生态只覆盖了可检索到的 DSH 插件；微信公众号/闭源产品（Trae、Qoder、通义灵码等）未纳入。
