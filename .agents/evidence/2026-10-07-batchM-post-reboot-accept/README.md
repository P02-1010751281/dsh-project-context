# 批次 M 重启后验收（2026-10-07）

**结论：批次 M 已在线，并且行为面（不只是时间戳）有两处实证。** 触发它的是一次**整机重启**
（系统启动 `2026-10-07 15:08`，desktop 宿主 pid 4996 于 `15:10:27` 启动），不是交接触发的重启脚本。

待办原文是「注入式压力行，**待宿主重启验收**」（`CONTEXT.md` 的 (a) 与「批次 M 的验证与边界」两条）。
本目录就是那次验收：`verify.sh` 是可复跑的控制，退出码 0 = 三条全过。

---

## 可复跑的控制

```bash
bash .agents/evidence/2026-10-07-batchM-post-reboot-accept/verify.sh
```

本次实测输出（`RESULT: PASS`，`EXIT=0`）：

```
== 1. load criterion: the socket holder started after the last src/ commit ==
  holder  pid=4996  started 2026-10-07T15:10:27+0800
  src/    3c97937  committed 2026-10-06T23:00:24+0800
  PASS  holder start is later than the last src/ commit (margin 58203s)
== 2. the loaded lib/ is the committed one ==
  PASS  git reports lib/ clean
  PASS  lib/ matches a fresh tsc compile (lib/client.js the only extra file)
== 3. the line is live inside a runtime-context message ==
  HIT   --mnt-Data-Projects-DSH-AV--/session-a099c90d-.../session.v4.jsonl.zstd
  HIT   --mnt-Data-Projects-dsh-project-context--/session-f7e001b6-.../session.v4.jsonl.zstd
  PASS  2 session(s) started after the holder carry the line

RESULT: PASS
```

第 3 条只认 `user/message` 且 `source.kind == "runtime-context"` 的那条消息，因为拿 `grep` 数会话
日志里出现过几次这个字符串毫无意义——日志会把 agent 自己的命令行与输出一起记下来（本仓库
Pitfalls 里那条已记过）。也正因为如此，**这个脚本自己的失败路径是活的**：写这一版时把
`cd "$(dirname …)/../.."` 写错了一层（落到 `.agents` 而不是仓库根），第 1、2 条立刻报红，第 3 条
照样能命中——一个空 `git log -- src/` 会静默返回空字符串而不是报错，于是 `holder > ""` 读成
「未加载」。根目录因此改成显式解析并验证（`package.json` + `src/project-handoff`）。

## 为什么这是行为实证，而不只是时间戳

批次 M 的全部对外表面是**一条 `systemPrompt.context` 贡献**（`src/project-handoff/display.ts` 的
`handoffPressureText`，跨线时冻结语言与数字）。同一个会话的日志里，这条文本被宿主物化成一份
`runtime-context` 快照；**只有它的文本变了才会追加一份新的**。

父会话 `session-f7e001b6`（workspace `--mnt-Data-Projects-dsh-project-context--`）里恰好留下了
重启前后的两份快照，逐字节对比只差两行：

```bash
D=~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/session-f7e001b6-8248-403e-91a4-cfba9f3cd43b
T1=$(zstdcat $D/*.zstd | jq -r 'select(.type=="user/message" and .time==1791301023796) | .data.content[0].text')
T2=$(zstdcat $D/*.zstd | jq -r 'select(.type=="user/message" and .time==1791357095511) | .data.content[0].text')
diff <(printf '%s' "$T1") <(printf '%s' "$T2")
```

```
95a96,97
> **自动交接状态（宿主注入，非用户发言）**：本会话上下文 211711 / 窗口 1000000（21%），已越过阈值 157000。自动交接只在轮次结束时评估，所以轮次内的越线不会立刻触发。请在回复中把这一状态与原因告知用户。
>
```

- 第一份快照（`1791301023796`，2026-10-06，批次 M 落地**之前**）里 0 命中；
- 第二份（`1791357095511` = `2026-10-07T15:11:35+08:00`，重启**之后**）里 1 命中；
- 两份之间**没有别的差异**——这条文本是那次重启唯一新注入的东西。

数字也对得上：`gate.ts` 解析出的阈值是 profile 级 `157000`（两个 workspace 都一样），占用是这一
刻的冻结读数。冻结设计也在同一份日志里成立：整个父会话只有 **2** 份 `runtime-context` 快照，而
重启后那一轮有 **7** 个 `step/start`（即 7 次 tick）——7 次 tick 只产出 1 次文本变化。

## 模型转述（批次 M 的另一半，两个 workspace）

那份注入行的结尾是一句指令：把状态与原因告知用户。两处都照做了：

- 本仓库的父会话（21%）：「宿主注入的状态转达给你：**本会话上下文 211,711 / 窗口 1,000,000（21%），
  已越过阈值 157,000**；自动交接只在轮次结束时评估……」
- **另一个 workspace**（`--mnt-Data-Projects-DSH-AV--` 的 `session-a099c90d`，标题 `↪ handoff · 7bfd4ba2`，
  27%）：「⚠ **上下文状态（宿主注入，非你的发言）**：本会话 271,032 / 1,000,000 tokens（27%），
  已越过 157,000 的**自动交接**阈值；交接只在轮次结束时评估，所以本轮尚未触发。」

跨 workspace 那一条是这次验收最强的部分：插件的这一段与 workspace 无关，所以它证明的是**宿主
在加载的 `lib/` 上真的调用了这条贡献**，而不是这个仓库里某个特例。

## 顺手得到的一条二阶证据

父会话那一轮的 `turn/end`（`1791357157955`）之后 **24 ms**，出现了本会话
`session-3aa66454`（标题 `↪ handoff · f7e001b6`，`createdAt` `1791357157979`）——**自动交接**在这条
越线会话上按既定路径发生了（评估只在 `turn/end`，与注入行的说法一致）。本会话的种子只有 585
字符，是纯指路（`<handoff>` 三个字段 + 「用户最后一次输入」），不带摘要。

## 必须记下的一处错误归因（下次别再犯）

父会话在同一轮里**同时**做了两件相反的事：它转述了注入行（等于握有「批次 M 在线」的直接证据），
却又在同一个回复末尾写「批次 M 的越线可见行仍需你重启宿主才在线……宿主持有者是 21:00:16 启动的
那个」。后半句是**假的**——持有者是 `15:10:27` 这个，而且它正在读的那条行就是批次 M 自己的输出。
它引用的是 `CONTEXT.md` 里写的旧结论，而不是按 `Key points` 第 1 条现跑一遍判据。

教训（与「Load state: re-derive it, never quote it from here」同一条，但这是它的**实例**）：**文档里的
判断与手上活证据冲突时，以活证据为准，并且当场重跑判据**；一份跑在越线会话里的回复尤其容易
把「上次验收时的装载状态」当成「现在」。

## 边界：这次验收**没有**证明的

- 模型**是否总是**转述（本类不可离线证明，与批次 I 的合规同类）。这里只证明两处都转了。
- 行内的数字是**跨线那一刻**的事实而非实时读数，越线后若压缩把它落回阈值以下，行要到下一次
  `turn/end` 才被清掉——设计如此，不是缺陷。
- 触发时机未变：评估仍然只在 `turn/end`。那是候选 (b)，仍未拍板。
