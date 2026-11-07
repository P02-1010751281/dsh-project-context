# maxMemoryChars 40000 → 45000 (2026-11-07)

## 决定

`maxMemoryChars` 从 40000 抬到 **45000**，`~/.dsh/profiles/desktop/cordis.patch.yml` 与
`~/.dsh/profiles/web/cordis.patch.yml` 同日对齐（备份：`cordis.patch.yml.bak-20261107-0900-maxmemory45000`）。
驱动因素是 2026-11-06 夜里的两次整理拒绝，签名与 2026-11-06T14:28 那次读上限半写无关：

```
2026-11-06T15:14:27.799Z [memory] the consolidation reply would have been stored lossily
  (11 whole entry(ies) would have been dropped from 3 section(s) because the memory document
  reached its character cap), and the one targeted retry did not fix it; ...
2026-11-06T15:21:43.119Z （同样的 11 条 / 3 节）
```

`MEMORY.md` 当时 39587 / 40000。这不是调参能绕开的死结：prompt 的压缩阶梯禁止为了腾地方删条目，
满文档唯一合法的动作是把 39587 字符的密集规则整体改写得更短，而模型时成时败（20:57 成、23:14 与
23:21 都败）。抬 cap 是把「必须在一次生成里压缩到 99% 以下」换成「有 5.4k 字符余量」。

## 实测（`probe.mjs`，跑在宿主加载的 `lib/` 上）

真实回复没有落盘（请求体不持久化、成本账本按会话聚合、宿主不写 `[memory]` 运行日志），所以用
**存储文档 + 11 条与文档条目均长相同的条目**重建，只有 40000 下复现日志签名（11 条 / 3 节）才算数：

| 量 | 读数 |
|---|---|
| 输入 | MEMORY.md 39587 字符（116 条，均长 337.7）· CONTEXT.md 3160 字符 |
| 重建回复 | ~43016 字符 + 布局 |
| cap 40000 | `sectionDropped 3` / `droppedItems **11**`，落地 39644 —— 与日志逐字对上 |
| cap 45000 | `sectionDropped 0` / `droppedItems 0`，落地 43464 |
| breakeven | **43500** → 40000 差 3500；45000 余 1500；**43000 还差 500**（上一轮估的 43000 不够，已排除） |
| 输出侧 fit（45000，两种 auxModel 形状 × 首调/重试头寸） | 全部 `clipped false`，`memoryHidden 0` |
| 重试拟合 breakeven | memory **45787** 字符起开始裁剪（CONTEXT 3160）→ 45000 之上只剩 **787**；CONTEXT 刷新到 2402 后同一读法是 **47087** / 余 **2087**（这条随 CONTEXT 长度移动，不是常数） |

重跑时条目数会随文档内容变化：探针只在 40000 不再整条丢（或丢的节数不再是 3）、或 45000 开始丢时才判失败，
并在计数不是 11 时打印一行 note —— **11 是 2026-11-07 的读数，不是常量**。

最后一行是这次抬 cap **没有**解决的东西：输入拟合裁剪仍是「报告、不拒绝」，而回复是整篇替换，
被剪过的视图一旦落地就覆盖原文。45000 让这条路径离得更近（787 字符），也是下一批要收口的行为问题。

## 这个探针不证明什么

- 它没有、也无法重放 23:14 那次真实回复；重建是按日志签名校准的**同形状**回复，不是同一份文本。
- 它不证明重启后的下一次整理会成功：那取决于模型这一次能不能在 45000 里写出完整文档。
- 它只覆盖 budget 半边与输出侧的输入拟合；模型输出上限（`maxOutputTokens` 32768）那半边不在射程内。

## 复跑

```bash
node .agents/evidence/2026-11-07-maxmemory-45000-raise/probe.mjs
# 0 = 45000 吸收重建的拒绝且 fit 干净；1 = 不成立；2 = 输入不可读（文档被改坏或缺失）
```

探针自己打印两份文档长度与重建参数，重跑时会显示是哪个输入动了。文档涨过 45000 时它直接判 1 ——
那时该重新做决定，而不是让这个证据继续「成立」。
