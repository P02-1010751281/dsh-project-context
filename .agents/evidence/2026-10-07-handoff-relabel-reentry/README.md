# 档 5（交接子会话标题事后自愈）为什么从未写过一个标题

只读判定 + 真 `SessionStore` 复现，2026-10-07。结论先写：**写入发生在 `Session.append` 的观察者
派发内部，而 `rename` 自己会 `append`，宿主的重入守卫每次都把它拒掉**；拒绝被本模块自己的
`catch` 吞成一条读不到的 warn，所以症状是「什么都没发生」。

## 现跑

```bash
node .agents/evidence/2026-10-07-handoff-relabel-reentry/probe.mjs   # exit 0 = 5/5
node --test test/handoff-relabel.test.mjs                            # 9 通过
```

修复前的同一探针（`lib/` 里还是同步写）打红第三条并印出真实原因：

```
ok    control: an in-envelope `rename` is refused, so the title stays as the handoff left it — ["↪ handoff · 9f80b44"]
ok    control: the store names the reason (`cannot reenter`)
ok    nothing is written while the dispatch envelope is open — ["↪ handoff · 9f80b44"]
FAIL  the deferred write lands after the envelope unwinds, exactly once — ["↪ handoff · 9f80b44"]
ok    no `title not updated` warning is logged — dsh-project-context: handoff continuation title not updated: %s session append cannot reenter while another append is being published
```

（最后一行是修复前的行为：警告里那句 `cannot reenter` 就是本模块吞掉的宿主拒绝。）

## 根因（源码，读自宿主加载的 store 检出）

| 步骤 | 位置 |
|---|---|
| 我们挂在 `session/event` 上 | `src/project-handoff/index.ts` 的 `user/message` 分支 |
| 宿主在 `append` 里派发观察者，且此时 `entry.appending = true` | `packages/core/session/src/index.ts:754`（置位）→ `:764`（派发）→ `finally :767-772`（复位） |
| 观察者是**同步**调用 | `session/src/index.ts:412`（`invokeContainedSessionObservers` 里直接 `callback(...args)`） |
| 事件已入日志，**顺序不是原因** | `session/src/index.ts:761` `this.log.push(event)` 早于 `:764` |
| `rename` 自己 append，于是被拒 | `packages/session/session-title/src/index.ts:412`；守卫在 `session/src/index.ts:740-743` |
| 宿主自己怎么绕开 | 同一个服务把兜底写放进 `this.defer(...)`（`session-title/src/index.ts:515`），`defer = Promise.resolve().then`（`:726`） |
| 宿主自己的用例 | `packages/core/session/tests/session.spec.ts:1681` `contains a reentrant observer append without reordering later observers` |

## 修复

`src/project-handoff/relabel.ts`：**判定**照旧同步（前缀判据 + `firstHandoffInput` + seq 门禁），
写入放进 `Promise.resolve().then(...)`；服务方法读一次、用 `.call(titles, …)` 保留接收者。
「最多写一次」仍由 seq 门禁保证。

## 为什么原来的 8 条具名用例全是绿的

`test/handoff-relabel.test.mjs` 用的是手写 fake session —— 它没有重入守卫，也没有真的 append，
所以「同步写」在它上面不可观测。新增的真 store 用例（`Context` + `SessionStore` + 一个 `rename`
真 append 的 `sessionTitle` 服务）自带**对照**：同一个 `rename` 在信封内被拒。这条对照是这条用例
存在的理由 —— 只有它能区分「写了但没生效」与「根本没写」。

## 现场的负样本（只读，两个 workspace）

重启（宿主 pid 4890 @ 22:44:59）之后，只有 2 个带前缀的交接子会话收到过自己首条 `kind=user` 输入：

| 会话 | 输入 | seq / 时间 | `session/title` 条数 |
|---|---|---|---|
| `42bcc5f4`（本 ws） | 「检查？」 | 123 @ 22:47:06 | 1 |
| `440ccfc9`（DSH-AV） | 「继续」 | 447 @ 22:47:10 | 1 |

两条日志里判据都成立（触发事件 seq 就是首条人类输入的 seq；存标题是 `↪ handoff · <父 id>`，
不是用户改名），所以「判据通过但没写」正是重入拒绝的形状。

## 顺带排掉的两个旧疑点

1. **事件顺序**：`this.log.push(event)`（`:761`）在派发（`:764`）之前，监听器读到的
   `snapshotEvents()` 已含该事件。
2. **`ctx.get("sessionTitle")` 不可用**：宿主 `SessionController.inject`
   （`packages/api/session-controller/src/index.ts:100-112`）**不含** `sessionTitle`，却用同一个
   `ctx.get('sessionTitle')` 读写（`commands.ts:195`），而这条路径确实工作（本会话标题即由它写下）。
   另外本探针的真 store 也已经走到 `rename` —— 也就是 `ctx.get` 在这一层解析成功。

## 尚未验证

宿主仍在跑旧 `lib/`，所以这条修复的**在线行为**未经宿主验收（判据：19387 持有者启动时间晚于
最后一个 `src/` 提交）。重启后判据转正，再在**从未被输入过**的交接子会话里打一句话，看是否出现
第二条 `session/title`。
