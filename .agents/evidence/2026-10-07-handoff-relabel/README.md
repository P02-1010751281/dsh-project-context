# 2026-10-07 — deferred continuation title（档 5）探针 + 验收控制（只读）

回答一个问题：`src/project-handoff/relabel.ts` 那条「交接子会话用**自己**第一条可用人类输入命名自己」
的规则，在真实语料上到底会写出什么？以及它的两个负例控制（横幅谓词、前缀判据）在真数据上是否成立。

## 跑它

```sh
pnpm build   # 探针判的是 lib/，不是 src/；陈旧构建 = 判陈旧行为
node .agents/evidence/2026-10-07-handoff-relabel/probe.mjs
```

只读：fold 本 workspace 的 `~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/`（需要 `zstdcat`），
不写盘、不联网。计数随会话增长，**引用必须现跑**；`exit 0` = 11/11 全过，任何 `FAIL` 都让它 `exit 1`。

## 它判什么

0. **自检**：探针导入的 `deferredHandoffLabel` / `storedHandoffLabel` 就是插件发布的那两个，且横幅
   fixture 真的被共享谓词 `isHandoffContinuationText` 认出来——否则后面所有结论都不成立。
1. **实现规则在真实语料上的输出**：每个交接子会话按 `deriveMessages()` 的最小形状重建后交给**已构建的**
   函数，再按「有用 / 噪声」分类，并检查每个标签都有可见字符、单行、不超 20 字符。
2. **负例控制（横幅谓词）**：同时本地算出 pre-fix 语义（首条 `kind=user`，不过滤横幅），要求
   「没有横幅成为标签」；并断言语料**仍在触发这一类**，否则报 stale 而不是静默通过。把谓词从 `lib/`
   去掉后本节翻红：横幅全部成为标签，且「横幅之后还有输入」的子会话数从 20 掉到 0。
3. **前缀判据**：对每个 folded 会话，`storedHandoffLabel` 为真**当且仅当**标题带 `↪ handoff · ` 前缀
   ——这是改写唯一的门，也是「用户自己改过名的标题永不覆盖」的根据。

## 已知近似（不要让它们变成结论）

- 探针从原始 `user/message` 事件重建消息列表，而插件读的是 `session.deriveMessages()`；对 user 消息两者
  一一对应，assistant/tool 消息与本规则无关。探针把多段文本折成一行（`clipTitle` 本来也折叠空白，
  所以标签本身不受影响）。
- `klass()` 的「有用 / 噪声」是**判定口径**，不是代码行为：它复刻
  `.agents/evidence/2026-10-07-handoff-title-label-survey/survey.mjs` 的分类，好让两套统计可对照。
- 探针判的是**会写出什么**，不判宿主的标题服务接受什么：`rename` 的归一化与拒绝面由
  `test/handoff-relabel.test.mjs` 的 fake service 与 `retitleAfterRename` 的既有 pin 各自负责。
