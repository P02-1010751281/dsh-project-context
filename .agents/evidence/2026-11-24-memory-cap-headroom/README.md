# 记忆顶到硬上限：抬 cap（A）与压缩（B）的实测记录

- 日期：2026-11-24。
- 取证对象：`.agents/memory/MEMORY.md` 与实际生效的两个 profile `cordis.patch.yml`。
- 探针：`probe.mjs`（只读，不写任何文件）。`node probe.mjs` 退出码 0 = 余量足够且加事实不丢条目。
- 用户裁定：A + B 都做（2026-11-24）。

## ① 为什么这不是「快满了」

整篇字符数只说明文档有多大，**说明不了还能不能增长**。真正的判据是分配器自己的度量：

```
需求 = Σ 各段 Σ min(条目长度, MAX_LIST_ITEM_CHARS) + BULLET_OVERHEAD_CHARS
可用 = maxMemoryChars - memoryStructureOverheadChars()
```

改动前两个数是 **51932 / 51933** —— 差 1 字符。也就是说文档虽然「只占 51999 / 52000」，但按分配器的
度量它已经满了：任何新增都会让某个段落必须在份额内丢掉整条。

## ② 后果是可复现的，而且丢的不是新事实

往**任意一段**加一条事实后重渲染，丢的是**别段**里已成立的条目：

| 新事实写进 | 被丢的条目 |
|---|---|
| Project | Index 的「回执本地化技能」指针 |
| Invariants | Project 的 `lifecycle.ts` onDispose 条 + Index 那条 |
| Pitfalls | 同上两条 |
| Index | Project 的 `lifecycle.ts` 那条 |

新事实自己留下，旧事实消失，`sectionDropped` / `droppedItems` 各为 1–2。这解释了此前 `/memory` 报的
「缺失字面量 14」：逐条核验后 12 条是引号风格或指针化改写（事实仍在），另 2 条是被这条机制挤掉的。

## ③ A：抬 cap 到 54000

两个 profile 同值（`web` 侧若更小会先裁，把另一侧腾出的余量吃掉）。抬后：

- 需求 51932 / 可用 53933，余量 **2001**。
- 四段各加一条事实，`droppedItems` 全为 **0**。
- 代价：每轮注入多约 2000 token。

## ④ B：压缩的是重复，不是事实

`MEMORY.md` 里 255 条几乎全是实打实的事实（废话标记接近 0），所以 B 不能靠「删废话」。可压缩的只有两类：

1. **同一命令的两条陈述**：`/memory reconcile` 的语义条（`2ac`）与实现条（`batch-aa2-reconcile-spec`），
   合并后保留双方全部字面量（含 `MAX_RECONCILE_LINES = 10`、`memoryReconcileReply` / `memoryAcceptReply`、
   `entry-state.ts` / `entry-states.ts`）。
2. **复述权威文档**：`RULES.md` 4.6 的八条边界判据、`docs/host-context-2c-design.md` §6 的三件缺口，
   改成「判据见 RULES 4.6」+ 保留全部符号本身，而不是逐条重抄。

结果：51999 → **51916**，字面量集合 **1242 → 1242（零丢失）**，条目 255 → 254（只少了合并的那一条）。

## ⑤ 复验方式：用插件 API，不用 grep

```
loadMemory(root, 54000)      -> truncated:false, damaged:0, poisoned:false, 51916 chars
renderMemoryDocument(...)    -> sectionDropped:0, droppedItems:0, itemTruncated:0
                               且 output === 落地字节（往返完全一致）
余量                          -> 2084
四段各加一条事实               -> droppedItems:0
```

写入路径是 `loadMemory` → `sectionsFromMarkdown` → 修改条目 → `renderMemoryDocument` → 写回，并在写盘前
要求「再解析再渲染」字节不变，**不是手改文件**：手改会绕过 `normalizeMemoryDocument` 的封顶，
下一次插件写入就会按旧 cap 截断。

## ⑥ 探针自身的两个缺陷（都已在落地前修掉）

1. **`check()` 没有 `await`**：五条检查里四条是 `async`，裸 `fn()` 会让它们的断言在汇总之后才跑 ——
   一条失败的探针照样 `RESULT: PASS`、退出码 0。第一次运行是真的踩到了：`demand … headroom 2084` 那行
   打在了 `RESULT` 之后。改成 `async function check` 并逐处 `await` 后，断言顺序回正。
2. **失败分支没被证明可达**：修完 async 仍可能恒绿，所以四条检查各做一次负控制（篡改断言使其必红），
   每次都只红目标项、`RESULT: FAIL (1)`、rc=1；还原后 sha256 一致、`RESULT: PASS`、rc=0：

| 编号 | 篡改 | 红的检查 |
|---|---|---|
| NC1 | 断言「往返**不**一致」 | 渲染字节一致（证明异步失败不再被吞） |
| NC2 | 断言两个 profile **不一致** | profile cap 一致 |
| NC3 | 要求余量 ≥ 999999 | 真实余量 |
| NC4 | 断言新增事实**会**丢条目 | 各段加事实都不丢 |

## ⑦ 这条 pitfall 值得记住的形状

「文档占 cap 的百分之多少」是错的健康指标。要判还能不能增长，比的是
`需求` 与 `cap - memoryStructureOverheadChars()`；两者差 1 字符时，加任何字符都会丢条目。而且丢的是
**别段**的旧事实——写入者看到的只有自己的成功。
