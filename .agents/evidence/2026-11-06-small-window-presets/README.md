# 小窗口（64K / 128K）下这套插件的账本

2026-11-06 实测。所有数字都能用 `node .agents/evidence/2026-11-06-small-window-presets/measure.mjs`
现读；探针走的是宿主实际加载的 `lib/`（`loadMemory` / `resolveThreshold` / `fitMemoryInput`），
不是对公式的转述。

## 一、没有任何东西随 `contextWindow` 缩放

`maxMemoryChars`（字符）、`MAX_CONTEXT_CHARS`（字符）、`MAX_CONVERSATION_CHARS`（字符）都是绝对量，
两份文档每轮无条件注入，只有交接阈值读 `contextWindow`。窗口从 1M 缩到 64K，文档的**相对**占比从
2% 涨到 34%，**绝对**占用一点没变。所以「换个 64K 模型」不会让这套东西自动变小，只会让它占满。

## 二、`maxMemoryChars` 同时是**读取**上限——这条是本次实测最要紧的发现

不是「写入前生效的上限」：

- 每轮注入：`src/project-memory/index.ts` 的 `text: (assembleContext) => projectMemoryInjection(…, effectivePluginConfig(entry).maxMemoryChars)`，
  而 `projectMemoryInjection` 调的是 `loadMemorySync(projectRoot, limit)`。
- 整理输入：`src/project-memory/consolidate.ts` 的 `const existing = await loadMemory(projectRoot, config.maxMemoryChars)`。

读写同一把尺，于是把它调到当前文档长度以下并不会「压缩」，而是**按行边界砍掉尾部**。实测
`MEMORY.md` 39587 字符时：

| cap | 注入侧拿到 | 隐藏 | 记忆 tokens | 分节条目 |
|---|---|---|---|---|
| 16000 | 15854 | 23790 | 6373 | Project=14 Invariants=30 **Pitfalls=0 Index=0** |
| 18000 | 17625 | 22019 | 7089 | Project=14 Invariants=35 **Pitfalls=0 Index=0** |
| 20000 | 19853 | 19791 | 7982 | Project=14 Invariants=42 **Pitfalls=0 Index=0** |
| 24000 | 23557 | 16087 | 9468 | Project=14 Invariants=53 **Pitfalls=0 Index=0** |
| 32000 | 31865 | 7778 | 12805 | Project=14 Invariants=54 Pitfalls=24 **Index=0** |
| 40000 | 39587 | 0 | 15898 | Project=14 Invariants=54 Pitfalls=35 Index=13 |

文档顺序是 Project → Invariants → Pitfalls → Index，裁剪保留头部，所以先消失的恰恰是
**Pitfalls（别再犯的坑）与 Index（东西在哪的指针）**——两节都是「模型最需要时才去找」的那种内容。
cap 18000 时 116 条里 67 条不在注入集里。

而且它会被固化。下一次整理 pass 读到的就是这 17625 字符（`cappedDroppedChars = 22019`，
`ConsolidateReport.clipped = true`、`memoryHiddenChars` 记这笔账），模型回吐它看到的视图，
写入路径**没有东西会拒绝**：

- tier C 只把回复与它**自己在同一 cap 下**的渲染相比，不与存储版比；
- `sectionsFromMarkdown(existing.text)` 要求四节齐全，缺节的文档返回 `undefined`，于是回归报告只写一行
  `memory regression guard skipped: the stored memory is not a plain four-section bullet document`
  ——把成因说成「文档形状不对」，而真实成因是上限（这类误归因在本仓是已知缺陷类）。

前一份文档在 `MEMORY.md.memory-backup-*`、变更在 `memory.jsonl`，能救回来；但前提是你注意到
`clipped: true`。所以顺序只有一种：**先把文档手写到目标尺寸，再把 cap 降到不小于新文档**。

## 三、64K / 128K 的阈值代数（B 表）

`capacity = W − 16384 − 4000`；`floor = overhead + keep + 8000`；可行 ⟺ `floor ≤ capacity`；
`threshold = min(knee(W), capacity)`。

- **W = 64K**：capacity = 43616，而 `knee(64000) = 64000 > capacity`，质量项永远不生效 →
  阈值只能落在 43616（68%）。可行条件因此是 `overhead + keep ≤ 35616`。
- **W = 128K**：capacity = 107616，`knee(128000) ≈ 128000` → 阈值 107616（84%），
  与 `keep`、与文档大小**都无关**。128K 上现有配置不用改。

今天 overhead（记忆 15898 + 上下文 5944 + 基线粗估 6000）= 27842，于是 64K 上：

| `handoffBudgetRecentTokens` | 64K 上的 auto 阈值 |
|---|---|
| 20000（默认） | 不可用（window-headroom：`27842 + 20000 + 8000 > 43616`） |
| 8000 | 不可用（drop-floor，差 226 token） |
| 4000 | 43616，触发点之上留给对话 15774 tokens |
| 0 | 同上（但新会话不再带原文尾部） |

也就是说**只把窗口换成 64K 会让自动交接整个失效**，除非同时把 `keep` 降到 4000 左右；
而 4000 的代价是新会话只带 4000 tokens 原文（`0` 则只有指针与最后一次输入）。
想让 64K 保留更多尾部，唯一办法是把文档压小：把记忆压到 18000 字符（7089 tokens）后，
`keep` 12000 也可用，同样阈值 43616 下留给对话 21079 tokens。

## 四、整理 pass 自己的请求也会撞窗（C 表）

`fitMemoryInput` 只按「记忆 + 上下文」算回吐预算，**不**算它同时重发的 `<recent-conversation>`
（上限 `MAX_CONVERSATION_CHARS = 50000` 字符，不可配置）与规则段。64K 上：

| cap | 对话块 | 输入≈ | 输出 | 合计 | 64K |
|---|---|---|---|---|---|
| 40000 | 0 | 23842 | 30512 | 54354 | 可放下 |
| 40000 | 25000 字符 | 36342 | 30512 | 66854 | **超窗** |
| 40000 | 50000 字符 | 48842 | 30512 | 79354 | **超窗** |
| 18000 | 50000 字符 | 40033 | 18620 | 58653 | 可放下 |

「把 `maxOutputTokens` 降到 16384」不是解：ceiling 一压，`fitMemoryInput` 就改成头尾各剪一刀，
实测 cap 40000 时记忆被剪 25035 字符、上下文被剪 6112 字符（`clipped true`）。64K 上今天的文档尺寸
没有任何一组设置能同时做到「不丢内容」和「不超窗」，只能先把文档压小。

## 五、结论

| | 64K | 128K |
|---|---|---|
| 现有配置直接能用 | 不能（auto 交接不可用） | 能（阈值 84%） |
| 最小改动 | `handoffBudgetRecentTokens` → 4000（或 0） | 无 |
| 想保留更多尾部/更多对话 | 先把 `MEMORY.md` 手写到目标尺寸，再降 `maxMemoryChars` 到不小于它 | — |
| 文档压到 18000 字符后 | `keep` 12000 可用；pass 的请求整段可放下 | — |

改设置是用户动作，两个 profile 各自独立（`cordis.patch.yml` 在各自 profile 里）。

## 六、窗口是「声明值」，而且宿主压缩插件有 64K 下限

插件读的窗口来自宿主模型解析结果（`resolved.context.contextWindow`），也就是设置 → 模型里每行的
「上下文窗口」，落盘在 `~/.dsh/settings.yaml` 的 `contextWindow`。**本插件自己没有窗口设置项**
（`config.ts` / `settings.ts` / `card-fields.ts` 里没有这个键）。

两个后果：

- 声明得比真实窗口小**不会**让请求变小——真实窗口 1M 却声明 64K 时，请求照旧放得下，
  于是「限住」的只有本插件的阈值和宿主的压缩判断，实际上下文该多长还是多长。
- 宿主的压缩插件（`packages/compaction/compaction-basic`）默认 `headroomTokens = 65_536`，它的
  压力预算是 `W − 保留输出 − headroomTokens`，一旦 `<= 0` 就抛 `TargetPressureConfigError`，
  提示「reduce the effective request maxTokens or compaction headroomTokens, or configure a larger
  adapter model contextWindow」。所以**任何 ≤ 65536 的声明都配不出压缩**，64K 想真跑必须把这个
  headroom 一起降（并确认该 profile 确实启用了这个插件）。
