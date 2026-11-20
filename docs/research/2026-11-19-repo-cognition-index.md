# 仓库认知索引（第七类）调研：17 个仓库、四条路线（2026-11-19）

> 触发：2026-11-18 的[同类系统调研](./2026-11-18-similar-projects.md)只覆盖六类玩家，漏了「给仓库建索引」
> 这一类（AOCI 就是在这条缝里被漏掉的）。本文补这一类，并把 AOCI 放回它的同类里比较。
> 证据包：`.agents/evidence/2026-11-19-repo-index-category/`（17 个仓库的 README + meta，35 行 manifest，
> `verify.sh` 35/35 通过）；AOCI 的实测在 `.agents/evidence/2026-11-19-aoci/`。
> 本文只做调研，不改 `src/`。

**目录**：0 结论 · 1 判据与纳入 · 2 全景 · 3 四条路线 · 4 矩阵 · 5 谁付账 · 6 与记忆的边界 ·
7 可搬/不搬 · 8 DSH 生态 · 9 未闭合项 · 10 证据

---

## 0. 结论

1. **这一类有 16 个独立系统（外加一个把它们搬进 DSH 的封装），但只有 AOCI 把「语义」交给宿主的
   模型写、并治理写入。** 其余多数是解析器（tree-sitter / LSP / 正则）落库（SQLite / 向量库 /
   内存图），再通过 MCP 或 CLI 查询；`repo-map` 也用 LLM 写备注，但只是逐文件生成，没有治理、
   没有交付证明。AOCI 的独特性不在「索引」，而在**谁写语义 + 谁治理写入**。
2. **四条路线的差别是「账单什么时候到」**，不是能不能省 token：注入式每轮付、打包式一次性付、
   查询式按次付、先验式在会话开头付一大块（AOCI 在本仓库实测 84,520 token）。
3. **索引不是记忆，两者的退休规则相反。** 索引是代码的导数——代码没了，索引就该消失或标 stale；
   记忆是人的承诺——代码没了，「当初为什么这样」仍然有效。把两者塞进同一个文档，一次整理就会互相擦除。
4. **对我们真正有用的不是索引，是它给「条目」加的三样东西**：对象身份、源绑定、漂移状态。
   我们已经有条目（145 条）和一半漂移（路径不存在/行号越界），缺的是**内容漂移**。
5. **DSH 生态里已经有两个这一类插件**（`dsh-aoci`、`dsh-code-index`），且后者测到 0.2.2-rc.3——
   比 AOCI 的 0.2.0-rc.2 更贴近我们的宿主。要不要用是另一个问题，但它们已经存在这件事本身
   说明「宿主内代码索引」是一个正在被填补的生态位。

---

## 1. 判据与纳入

**纳入判据**（四条都要满足，否则只是「读文件的工具」）：

1. 产物**持久**（不是每次现算）；
2. 跨会话/跨任务可复用；
3. **先于任务存在**（不是任务来了才检索）；
4. 产物**可复核**（能 diff、能验证、能说清哪部分过期）。

按这四条：`repomix` / `gitingest` / `code2prompt` / `files-to-prompt` 严格说不满足 1 和 3（它们
每次打包），`aider` 的 repo map 也不落盘——但它们构成这一类的「负样本基线」，说明**不做持久化
也能拿到大部分收益**，所以保留在表里并标注。

**证据规则**：全部来自各仓 README（默认分支原文，URL 见 `urls.tsv`）；星数与许可是 2026-11-20 的
API 快照；**除 AOCI 外没有安装试用**，所有「能省多少 token」都是厂商自述。

---

## 2. 全景

| 系统 | ★ | 路线 | 产物 | 许可 |
|---|---:|---|---|---|
| **AOCI-CODE** `aoci-spec/aoci-code` | 2,610 | 模型作者 + 程序治理 | 仓库内 `aoci*.txt`（Git 版本化） | FSL-1.1-MIT |
| **repomix** `yamadashy/repomix` | 29,344 | 一次性打包 | 单文件 + token 计数 + MCP | MIT |
| **serena** `oraios/serena` | 31,540 | 借宿主能力（LSP） | 符号工具 + 文件式 memories | NOASSERTION |
| **claude-context** `zilliztech/claude-context` | 12,708 | 向量检索 | Milvus/Zilliz 向量库 | MIT |
| **gitingest** `coderamp-labs/gitingest` | 16,158 | 一次性打包 | 提示词友好文本 | MIT |
| **aider** `Aider-AI/aider` | 50,188 | 随请求生成 | repo map（PageRank，不落盘） | Apache-2.0 |
| **codesight** `Houseofmvps/codesight` | 1,426 | 生成宿主规则文件 | `CLAUDE.md`/`AGENTS.md`/`.cursorrules`/`codex.md` + 14 MCP 工具 | MIT |
| **code2prompt** `raphaelmansuy/code2prompt` | 887 | 一次性打包 | 模板化提示词 | MIT |
| **codanna** `bartolli/codanna` | 764 | 解析器落库 | 符号/调用图/影响分析（Rust，15 语言） | Apache-2.0 |
| **code-context-engine** `elara-labs/code-context-engine` | 466 | 解析器落库 | SQLite + tree-sitter 索引 | MIT |
| **CodeGraph** `codegraph-ai/CodeGraph` | 163 | 解析器落库 | 语义图（38 语言，42 MCP 工具） | Apache-2.0 |
| **repo-map** `cyanheads/repo-map` | 67 | 模型备注 + 缓存 | `_repo_map.md`（每文件 LLM 备注） | Apache-2.0 |
| **srclight** `srclight/srclight` | 59 | 解析器落库 | SQLite FTS5 + tree-sitter + 向量，42 工具 | MIT |
| **files-to-prompt** `simonw/files-to-prompt` | 2,805 | 一次性打包 | 目录拼接 | Apache-2.0 |
| **goldfish** `dereira/goldfish` | 3 | 随请求生成 | Go 版 aider repo map，token 预算 | MIT |
| **dsh-code-index** `lemonxiny55/dsh-code-index` | 9 | DSH 插件 | Context Packs / 影响分析（8 工具） | MIT |
| **dsh-aoci** `Fourteenth-Night/dsh-aoci` | 0 | DSH 插件（封装 AOCI） | AOCI 的 9 MCP 工具 + 确定性工具 | MIT |

---

## 3. 四条路线

### 路线 A：模型作者 + 程序治理（AOCI 一家）

模型读源码、为每个受管对象写一行 FRAS；程序做作用域、基线、校验、CAS、原子写、恢复；
产物是纯文本、进 Git。**这是唯一让「语义」离开解析器的一条路**，代价是首次建索引要模型算力
（README 自述 ≈1 小时 / 20 万行；本仓库实测预估 84,520 token / 744 个待写条目）。

### 路线 B：解析器落库（CodeGraph、codanna、srclight、code-context-engine、claude-context、codesight）

tree-sitter / LSP 抽符号，落 SQLite 或向量库，MCP 暴露几十个工具。共同赌注：**模型不该读代码，
该问工具**。代表口号：srclight「40–60% token 花在定位上」、CCE「94% 节省」、codesight
「一次生成，别每次重新摸索」——都是自述，未复现。

### 路线 C：随请求生成（aider、goldfish）

tree-sitter 抽 tag → 符号图 → PageRank → 按 token 预算渲染 repo map，**随每次请求发送**，不留可复核的持久产物。
这是最省事的一条：没有索引要维护，代价是每次都重算、且只能给「结构」，给不了职责与约束。

### 路线 D：一次性打包（repomix、gitingest、code2prompt、files-to-prompt）

把仓库拼成一个（可压缩的）文本，塞进 prompt。严格说不是索引，但它是这一类的**基线**：
如果任务只需要「看一眼全貌」，打包比任何索引都便宜。

### 交叉：借用宿主能力（serena）

serena 不做自有索引，靠 LSP 在宿主进程里查符号；另有一套**文件式 memories**。它同时踩在
「代码索引」和「记忆」两条线上，是唯一一个既做符号又做记忆的样本——值得单独看它的 memory 设计。

---

## 4. 矩阵

| 系统 | 索引形态 | 谁写语义 | 持久位置 | 维护/漂移 | 交付 | DSH |
|---|---|---|---|---|---|---|
| AOCI-CODE | 文本 Volumes | **模型** | 仓库内（Git） | 基线 + 漂移七分类 + 增量 | MCP 9 工具 / CLI / UI | 有（dsh-aoci） |
| repomix | 单文件 | 无（结构） | 每次生成 | 无 | CLI / MCP | — |
| serena | 无（LSP 实时） | 无 | LSP + memories 文件 | 实时 | MCP | — |
| claude-context | 向量库 | 嵌入 | Milvus/Zilliz | Merkle 增量 | MCP | — |
| gitingest | 文本 | 无 | 每次生成 | 无 | CLI / Web | — |
| aider | 内存 repo map | 无（PageRank） | 无持久语义产物 | 每次重算 | 随请求 | — |
| codesight | 宿主规则文件 | 解析器（AST/正则） | 仓库内（生成文件） | watch / git hook 重生成 | 文件 + MCP | — |
| code2prompt | 文本 | 无 | 每次生成 | 无 | CLI | — |
| codanna | 本地图/索引 | 解析器 | 本地 | 重索引 | MCP / CLI | — |
| code-context-engine | SQLite | 解析器 | 本地 | 增量 | MCP | — |
| CodeGraph | 图 | 解析器 | 本地 | 重索引 | MCP / IDE 插件 | — |
| repo-map | Markdown 树 | **模型备注** | 仓库内 `_repo_map.md` | SQLite 缓存，只重发变更文件 | CLI | — |
| srclight | SQLite FTS5 + 向量 | 解析器 + 嵌入 | 本地 | 增量 | MCP（42 工具） | — |
| files-to-prompt | 文本 | 无 | 每次生成 | 无 | CLI | — |
| goldfish | 内存 repo map | 无（PageRank） | 无持久语义产物 | 每次重算 | CLI | — |
| dsh-code-index | 本地索引 | 解析器 | 本地 | 增量 + 变更影响 | DSH 工具（8） | 是 |
| dsh-aoci | 同 AOCI | **模型** | 仓库内 | 同 AOCI | DSH 工具 + MCP | 是 |

---

## 5. 谁付账：索引不是免费的

| 路线 | 付费时机 | 单次成本 | 风险 |
|---|---|---|---|
| 注入式（aider repo map） | **每轮** | 结构大小（可预算） | 每轮都占窗口 |
| 打包式（repomix/gitingest） | **每次任务** | 全仓或压缩后体积 | 大仓装不下 |
| 查询式（CodeGraph/srclight/CCE） | **每次查询** | 工具调用 + 返回片段 | 多轮往返；工具面本身要 token |
| 先验式（AOCI/codesight/repo-map） | **会话开头一次** | AOCI 本仓库实测 84,520 token | 压缩后作废，需重载 |

这解释了为什么「索引」和「记忆」不能互换：记忆是**每轮都付但很小**（44,996 字符 ≈ 11K token），
索引是**一次付很大**（84.5K）。两者都在抢同一个窗口，只是账期不同。

---

## 6. 与记忆的边界

| 维度 | 仓库认知索引 | 项目记忆 |
|---|---|---|
| 描述对象 | 系统**是什么样** | 人**决定过什么**、什么不能破 |
| 代码删除后 | 条目应消失或标 stale | 事实仍成立（「当初为什么」不会因为文件没了而失效） |
| 退休规则 | 按漂移（drift） | 按年龄 / 未确认 / 被取代（supersede） |
| 权威 | Git 里的索引 + 基线 | 追加式 `memory.jsonl` |
| 谁写 | 模型（AOCI）或解析器（其余） | 只有模型，且整次拒绝有损回复 |

**推论**：不能把 AOCI 的索引塞进 `MEMORY.md`。两种生命周期混在一个文档里，一次整理 pass 就会
用「代码变了」把「人的承诺」退休掉，或者反过来用年龄把刚建立的结构地图删掉。

---

## 7. 对本仓库：可搬三条 / 不搬三条

**可搬**

1. **对象身份 + 源绑定**（AOCI 唯一）。我们的记忆条目有身份（正文 sha 前 3 位）但没有「对象」；
   `anchorDriftReasons` 只判路径存在与行号越界，**判不了内容漂移**（文件在、事实已变）。
2. **证据边界的措辞**。`dsh-code-index` 写得很准：「missing evidence is not evidence of absence」
   「static relations do not prove runtime impact」——这正是我们 misattribution 纪律的同构表达，
   可直接借到回执与 `errors.log` 文案里。
3. **覆盖率/新鲜度指标**。AOCI 有五态里的 `coverage_percent`，srclight 有 `detect_changes`，
   repomix 有 token 计数；我们的 `/memory` 只报「有多少条」，不报「有多少条可能过期」。

**不搬**

1. **建库**（SQLite / 向量 / 图）：我们的权威是文本 journal，加一个库就是第二个权威源。
2. **几十个 MCP 工具**：本包现状不注册工具，工具面本身也是每轮成本（AOCI 实测 12.7–16.4K 字符）。
3. **给整仓建索引**：84.5K token 的实测代价 + 它会把 `.agents/evidence/` 当代码（一家 98 个文件）。

---

## 8. DSH 生态：两个插件

| 插件 | 版本/日期 | 工具面 | 自测宿主 | 值得注意的细节 |
|---|---|---|---|---|
| `dsh-aoci` | v0.3.6 / 2026-10-26 | 9 MCP + ~15 确定性工具，可折叠成 compact 面 | DSH **0.2.0-rc.2** | 二进制 SHA-256 校验；压缩桥 fold→fold+compact；`readOnly` |
| `dsh-code-index` | v0.13.0 / 2026-11-17 | 8 工具 | DSH **0.2.2-rc.1 / rc.3** | 证据边界写得很硬；Context Pack 有字符预算 300–20,000 |

两者都不改我们的文件、都在同一个宿主里注册工具面。差别：前者把「代码理解」外包给一个 Go 二进制，
后者是纯 Node 插件；前者的语义由模型写，后者是确定性解析。

---

## 9. 未闭合项

1. **没有安装试用**这两个 DSH 插件；兼容性只按 README 自测版本推断（本机 0.2.2-rc.3）。
2. **厂商 token 声称未复现**：94%、40–60%、«数千 token» 全是自述。
3. **AOCI 的语义质量仍未测**（条目由模型写，我们只跑了确定性半边）。
4. **星数是快照**，且这一类的星数分布极端（50,188 到 0），不能当质量信号。
5. **没有评估「记忆向」的同类**：本类里只有 serena 同时做 memory，值得单独看它怎么存。

---

## 10. 证据

- 本包：`.agents/evidence/2026-11-19-repo-index-category/`（`list.txt` 17 个仓库、`sources/` 35 个文件、
  `urls.tsv` 实际 URL、`manifest.tsv` 35 行、`verify.sh` 自检）。
- AOCI 实测：`.agents/evidence/2026-11-19-aoci/`（含 `probe/` 13 份原始输出）。
- 六类全景（2026-11-18）：[similar-projects.md](./2026-11-18-similar-projects.md)。
