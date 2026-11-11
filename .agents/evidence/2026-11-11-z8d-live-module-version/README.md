# Z8d 是否已在运行？—— 用宿主里常驻的模块源码判定

> 测量时刻 2026-11-11T14:41+08:00，仓库 `HEAD = c4274c2`，宿主 pid 71971（10:41:56 启动），inspector `127.0.0.1:9230`。

## 为什么要换判据

既有判据是「socket 持有者的启动时刻晚于最后一条 `src/` 提交」（记忆不变量 `266f`）。本次它给出的是**否定**答案，但同一台机器上的行为证据与之冲突：14:21:28 的一次整理 pass 把 `MEMORY.md` 从 44,589 字符、0 个 id，写成 44,997 字符、131 个 id，且分布是 Invariants 64 → Pitfalls 44 → Project 17 → Index 6，正是**部分盖章**的优先级顺序——而 all-or-nothing 版做不出这个形状。

两者只能有一个是真的，所以改判据：读**运行中 isolate 里常驻的模块源码**，再和 `git show <commit>:lib/…` 的 blob 逐字节比。

## 测量结果

| | sha256（前 16） | 归属 |
|---|---|---|
| 宿主常驻 `lib/project-memory/retirement.js` | `658a6c81a8adea42…` | `9864d05`（13:54:51 部分盖章版；`070eacc`、`8b34e6a` 的 `lib/` 与之同 blob） |
| 磁盘 `lib/project-memory/retirement.js` | `7dc2c223fd2a8c41…` | `e9c4214`（14:31:30 近上限边界版） |

**判定：STALE。** 宿主执行的是 13:54:51 的构建，14:17:10 的 `keepIds` 与 14:31:30 的近上限边界都还没进去 → 仍需重启。

三件事因此自洽了：

1. 14:21 的 pass 用 13:54 的代码跑，所以有部分盖章（131 个 id）；
2. `entries.json` 只有 131 个「正文携带」的 id 而不是 `keepIds` 的 140，因为 13:54 版还没有 `keepIds`；
3. 10:41 启动那一刻，磁盘上最新只可能是 `7e200dd`/`d4bb012` 的 all-or-nothing 版（blob `ffa1fea6…`，它前一晚 21:39 提交，此后到 13:54 才再有 `src/` 提交），而常驻的是 13:54 的 `658a6c81` —— 所以 13:54 之后确实发生过一次**未重启的换码**：插件代码可以在进程内被换掉，但 14:17 之后没有再换。

结论保持不变（重启），理由换成了可复核的那一条：常驻模块与磁盘不一致。

## 复现

```bash
node .agents/evidence/2026-11-11-z8d-live-module-version/probe.mjs            # 默认 9230 端口、retirement.js
node …/probe.mjs --file lib/project-memory/consolidate.js --port 9230        # 换文件
```

probe 只开 `Debugger.enable` 读脚本源码，结束前 `Debugger.disable`；无写入、无重启、无代码执行。宿主没有 inspector 端口时，先 `kill -USR1 <host pid>` 开 9229/9230（本项目既有的只读取证手法）。

## 重启后的验收

1. `probe.mjs` 的 `verdict` 变成 `the running host executes the code on disk`，磁盘侧归属应为 `e9c4214`（或更新）。
2. 下一次整理 pass 之后：`MEMORY.md` 140 个 id、渲染 0 丢弃 / 0 截断（本次以 `c4274c2` 的文档现算：44,825 → 44,879 字符，`stamped: true`，`keepIds` 140）；
3. `entries.json` 应为 140 个 id（`keepIds`，含未盖章条目），而不是「正文携带」的 131；
4. `errors.log` 不再出现新的 `memory regression:` 行。

## 追加：Z8e（阈值合成一个键）—— 同一次重启的第三条判据

> 测量时刻 2026-11-11T15:30+08:00，仓库 `HEAD = 23cc23a`，宿主仍是 pid 71971（10:41:56 启动，早于 Z8e 的两个提交 `3692170` / `5ccd5e6`）。

Z8e 改了配置形状，于是除了模块哈希还有一条更省事的判据：**宿主自己发布的设置 schema**。它不需要
inspector 端口，是宿主对该 entry 的投影，旧键还在就说明旧模块在跑。

| 判据 | 现在（未重启） | 重启后应为 |
|---|---|---|
| `cordis_inspect_query`（host `Config`，`entry: include:project-context`）的 `schema.properties` | `handoffThresholdAuto`（boolean，默认 `true`）+ `handoffThresholdRatio`（number，`0.1`–`0.95`） | 只有 `handoffThreshold`（**string**，默认 `"auto"`），两个旧键消失 |
| `probe.mjs --file lib/shared/threshold-spec.js` | `not loaded (the file is not parsed in this isolate)` | `the running host executes the code on disk` |
| `probe.mjs --file lib/project-handoff/threshold.js` | `STALE`：常驻 blob（`0a082ca0…`）与 `3692170` 及更早的提交同 blob —— 该提交只新增解析模块、没动这个文件，所以常驻的是**合并前**的 `threshold.ts`；磁盘 blob（`3451df11…`）属于 `5ccd5e6`+ | 同上 |

三条互相自洽：新模块从未被解析、`threshold.js` 仍是合并前的版本、schema 仍声明两个旧键 —— 宿主跑的是
Z8e 之前的构建。（不要把 `3692170` 出现在「常驻归属」里读成「已经加载了一半」：它没改这个文件。）

**重启后顺手验收的三条行为**（本会话窗口 1,048,576，`capacity = W − 4000 = 1,044,576`）：

1. `/handoff threshold 400k` 的回执是 `threshold 400000 tokens` —— 在这个窗口上不截断；`(capped to N)` 只在 `asked > capacity` 时出现；
2. `/handoff status` 的固定模式摘要：迁移后的 desktop profile 是 `"0.4"`，应写 `fixed ratio 40%`；写 token 数时是 `fixed threshold N tokens`；
3. 设置卡上阈值只有**一行文本框**（旧版是「开关 + 比例」两行），提示语 `field.handoffThresholdHint`，默认值 `auto`。

注意 profile 与重启是**一步**：`~/.dsh/profiles/desktop/cordis.patch.yml` 已是 `handoffThreshold: "0.4"`，而运行中的旧模块
只认旧键 —— 重启前保存设置卡，旧代码会按旧键把文件写回去。
