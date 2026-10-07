# 2026-10-07 — deferred continuation title（档 5）探针 + 验收控制（只读）

回答一个问题：`src/project-handoff/relabel.ts` 那条「交接子会话用**自己**第一条可用人类输入命名自己」
的规则，在真实语料上到底会写出什么？以及它的三个负例控制（横幅谓词、**持久日志 vs 压缩后的表面**、
前缀判据）在真数据上是否成立。

## 跑它

```sh
pnpm build   # 探针判的是 lib/，不是 src/；陈旧构建 = 判陈旧行为
node .agents/evidence/2026-10-07-handoff-relabel/probe.mjs
```

只读：fold 本 workspace 的 `~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/`（需要 `zstdcat`），
不写盘、不联网。计数随会话增长，**引用必须现跑**；`exit 0` = 13/13 全过，任何 `FAIL` 都让它 `exit 1`。

## 它判什么

0. **自检**：探针导入的 `firstHandoffInput` / `storedHandoffLabel` 就是插件发布的那两个，且横幅
   fixture 真的被共享谓词 `isHandoffContinuationText` 认出来——否则后面所有结论都不成立。
1. **实现规则在真实语料上的输出**：每个交接子会话按 `snapshotEvents()` 的最小形状重建后交给**已构建的**
   函数，再按「有用 / 噪声」分类，并检查每个标签都有可见字符、单行、且 `前缀 + 标签` 不超宿主的
   `maxTitleBytes: 80`（字节，不是字符数）。
2. **负例控制（横幅谓词）**：同时本地算出 pre-fix 语义（首条 `kind=user`，不过滤横幅），要求
   「没有横幅成为标签」；并断言语料**仍在触发这一类**，否则报 stale 而不是静默通过。把谓词从 `lib/`
   去掉后本节翻红：横幅全部成为标签，且「横幅之后还有输入」的子会话数从 20 掉到 0。
3. **负例控制（持久日志）**：压缩（`compact-checkpoint` 的 ranged `replace`）会把早先的 surface 节点
   从 `deriveMessages()` 里删掉，所以本地同时算出「压缩后的表面还能看到的第一条输入」，要求两者**至少
   在一个子会话上不同**——本批实测 4 个子会话带压缩、4 个都会被两种口径命名成不同的标题。把读取面从
   `snapshotEvents()` 换回 `deriveMessages()` 后本节翻红。
4. **前缀判据**：对每个 folded 会话，`storedHandoffLabel` 为真**当且仅当**标题带 `↪ handoff · ` 前缀
   ——这是改写唯一的门，也是「用户自己改过名的标题永不覆盖」的根据。

## 已知近似（不要让它们变成结论）

- 探针从原始 `user/message` 事件重建日志，与插件读的 `session.snapshotEvents()` **同一个面**（插件
  也因此与宿主自己的标题读者同源：`collectSessionTitleMessages(session.snapshotEvents())`）。唯一差别
  是探针把多段文本折成一行；`clipTitle` 本来也折叠空白，所以标签本身不受影响。
- 第 3 节的「表面」是**近似**：它把落在某个 replace 区间内的 `kind=user` 事件视为被遮蔽，而不是重放
  宿主的 surface 折叠算法。它只用来证明「两种口径在这份语料上确实不同」，不作为 `deriveMessages()`
  行为的断言。
- `klass()` 的「有用 / 噪声」是**判定口径**，不是代码行为：它复刻
  `.agents/evidence/2026-10-07-handoff-title-label-survey/survey.mjs` 的分类，好让两套统计可对照。
- 探针判的是**会写出什么**，不判宿主的标题服务接受什么：`rename` 的归一化与拒绝面由
  `test/handoff-relabel.test.mjs` 的 fake service 与 `retitleAfterRename` 的既有 pin 各自负责。
