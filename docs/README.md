# 文档索引

用户手册是仓库根的 [README.md](../README.md)；本目录放「机制怎么运转、为什么这样设计」的长文。
逐版本变更：未发布在 [CHANGELOG.md](../CHANGELOG.md)，已发布各版本在 [changelog/](./changelog/)。

## 当前生效的文档

| 文件 | 回答什么 |
|---|---|
| [architecture.md](./architecture.md) | 架构与数据流、数据布局（每个文件干什么）、源码结构 |
| [behavior.md](./behavior.md) | 四个阶段的闸门与边界（① 归档、①补 回填、②③④） |
| [settings.md](./settings.md) | 配置详解：命名空间、卡片语义、每个键的完整边界 |
| [development.md](./development.md) | 门禁、`lib/` 产物纪律、依赖边界、卡片测试怎么搭 |
| [vocabulary-conventions.md](./vocabulary-conventions.md) | 配置键与命令的用词约定（改名不许只改一半） |
| [batch-v-memory-staleness-spec.md](./batch-v-memory-staleness-spec.md) | 记忆条目的内容漂移（Batch V 规格）：源绑定、四态判定、只标不删；预检证据在 `.agents/evidence/2026-11-20-batch-v-preflight/` |
| [memory-rewrite-loss-gate-spec.md](./memory-rewrite-loss-gate-spec.md) | 记忆整篇重写会静默概括（规格）：tier C 的盲区、标识符存活校验、首版只报不拒 |
| [batch-aa-state-machines-spec.md](./batch-aa-state-machines-spec.md) | 批次 AA 规格（2026-11-21）：三个核的状态机、两只过期探测器、碎片整理与核心间咬合；含 6 个待裁定问题，**尚未动 `src/`** |
| [batch-aa2-reconcile-spec.md](./batch-aa2-reconcile-spec.md) | AA2 规格：内容漂移 → **七态状态机**。实测 25 条有绑定、6 条已漂移（精度 1/6，故不自动退役）；§12 是最终形状（七态、五类事实、谁能点转移、每个状态必须有出口），AA2a/AA2b/AA2c/AA2d/AA2e 已落地，`pnpm test` 749 |
| [batch-w-decision-seam-spec.md](./batch-w-decision-seam-spec.md) | 交接判定缝的规格；仍被 `src/project-handoff/{auto,decide}.ts` 与 `test/handoff-decide.test.mjs` 直接引用，故不归档 |
| [handoff-candidates-b-c.md](./handoff-candidates-b-c.md) | 交接触发点 / 子会话标题三条路线的取舍；其中 (c) 仍待拍板，故留在本目录 |
| [harness/](./harness/README.md) | 各宿主接口的采用与未采用登记（dsh / pi / codex / integration） |
| [sibling-repos.md](./sibling-repos.md) | 同族仓库对照（dsh / pi / codex），以及只读勘查的规矩 |
| [research/2026-11-18-similar-projects.md](./research/2026-11-18-similar-projects.md) | 同类系统与组件级相似物调研；原始证据在 `.agents/evidence/2026-11-18-similar-projects-research/` |
| [research/2026-11-19-aoci.md](./research/2026-11-19-aoci.md) | AOCI（仓库级认知索引）调研：机制、论文数字的读法、与本仓库的分域裁定；三条借鉴的落地去向见 §7.1；证据在 `.agents/evidence/2026-11-19-aoci/` |
| [research/2026-11-19-repo-cognition-index.md](./research/2026-11-19-repo-cognition-index.md) | 第七类（仓库认知索引）全景：17 个仓库、四条路线、付费时机矩阵；补 2026-11-18 的漏项；证据在 `.agents/evidence/2026-11-19-repo-index-category/` |
| [compaction-vs-handoff.md](./compaction-vs-handoff.md) | 压缩与交接的边界、阈值交叉点、`/handoff status` 压缩行的实现与规格（W1-C 已落地）、`compactNow` 探针清单 |
| [improvement-plan-2026-11-18.md](./improvement-plan-2026-11-18.md) | 调研后的分波改进方案（检索、状态、压缩感知、技能、任务、导出）与五项待拍板 |
| [repo-metadata.md](./repo-metadata.md) | GitHub About / Topics 文案 |
| [upstream-pi-triage.md](./upstream-pi-triage.md) | pi 上游逐提交比对档案（每次 pass 的裁定都在这） |
| [upstream-issue-client-send-path.md](./upstream-issue-client-send-path.md) | 上游 issue 草稿：宿主重启后标签页静默无法发送 |

## 历史档案：[archive/](./archive/)

已收口批次的决策档案，只在上游对账时翻。它们解释「当时为什么这样改」，**不是现状说明**；
现状以 `architecture.md` / `behavior.md` / `settings.md` 与代码为准。

| 文件 | 批次与内容 |
|---|---|
| [batch-b-port-brief.md](./archive/batch-b-port-brief.md) | B：`record_memory` 结构化分区走工具 |
| [batch-b-residual-decisions.md](./archive/batch-b-residual-decisions.md) | B 残留：`callAux` 工具回退、autolearn 先重试再读 |
| [batch-c-loss-receipt-brief.md](./archive/batch-c-loss-receipt-brief.md) | C 档 A：回执点名丢失 |
| [batch-c-tier-c-design.md](./archive/batch-c-tier-c-design.md) | C 档 C：一次定向重试后拒绝有损写入 |
| [batch-d-autolearn-supersede-brief.md](./archive/batch-d-autolearn-supersede-brief.md) | D：autolearn 可取代自己生成的技能 |
| [batch-e-command-surface-ruling.md](./archive/batch-e-command-surface-ruling.md) | E：命令面一名一义 |
| [batch-g-autolearn-pull-brief.md](./archive/batch-g-autolearn-pull-brief.md) | G：autolearn 按需拉取技能正文 |
| [batch-h-vocabulary-keys-brief.md](./archive/batch-h-vocabulary-keys-brief.md) | H：配置键镜像命令路径 |
| [batch-h-vocabulary-keys-ruling.md](./archive/batch-h-vocabulary-keys-ruling.md) | H 裁定：一层一个通知前缀 |
| [batch-i-progressive-injection-brief.md](./archive/batch-i-progressive-injection-brief.md) | I：两个注入文档改渐进披露 |
| [batch-j-drop-summary-brief.md](./archive/batch-j-drop-summary-brief.md) | J：去掉摘要、只带指针 |
| [batch-m-handoff-visibility.md](./archive/batch-m-handoff-visibility.md) | M：让「越线」可见（注入路线） |
| [batch-n-shares-are-targets-brief.md](./archive/batch-n-shares-are-targets-brief.md) | N：段配额降为目标值 |
| [batch-o-single-read-brief.md](./archive/batch-o-single-read-brief.md) | O：一次读取 + 一版本纪律 |
| [batch-q-document-shape-brief.md](./archive/batch-q-document-shape-brief.md) | Q：回复须带文档形状才算 memory |
| [batch-q2-acceptance-guard-brief.md](./archive/batch-q2-acceptance-guard-brief.md) | Q2：回复不得丢掉 store 里已有的段 |
| [batch-r-retry-headroom-brief.md](./archive/batch-r-retry-headroom-brief.md) | R：重试头寸带上真实花掉的隐藏思考 |
| [batch-s-opencode-aux-route-brief.md](./archive/batch-s-opencode-aux-route-brief.md) | S：opencode 路由缺 `x-opencode-session` |

## 写作与引用约定

- **README 只留结论 + 指针**，长段说明写进本目录；一个事实只有一处权威副本，其余地方只指过去。
- 新批次的决策档案写进 `docs/archive/`，并在上面两张表之一登记；发版后 `CHANGELOG.md` 的
  「未发布」整段搬进 `docs/changelog/<version>.md`，目录加一行。
- 跨文件引用写**仓库相对路径**（`docs/...`），不写本文件相对路径——文件一挪就断。
- `.agents/evidence/` 是冻结的证据，**不回改**：里面出现的旧路径描述的是当时读到的树。
