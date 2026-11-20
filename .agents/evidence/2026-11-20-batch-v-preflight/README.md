# Batch V 预检：记忆条目的可绑定锚点（2026-11-20）

只读预检，回答一个问题：**如果给每条记忆条目绑源文件哈希，要绑多少个、花多少 I/O、当前有多少条过期。**

## 怎么跑

```bash
node probe.mjs      # 条目/锚点/可绑定/哈希总量/当前 drift
node classify.mjs   # 锚点分类：可绑定 / 自引用 / 仓外
```

两个脚本都从 `lib/` 导入**构建产物**（`loadMemory`、`sectionsFromMarkdown`、`anchorDriftReasons`），
不是 `src/`；改过 `src/` 需先 `pnpm build`。

## 结论（2026-11-20 现读）

| 项 | 值 |
|---|---:|
| 条目 | 145 |
| 带可核验锚点 | 33 条 / 44 处 |
| 可绑定文件 | 34 个，合计 1.06 MB（最大 `test/logic.test.mjs` 370.6 KB） |
| 自引用（`.agents/memory/*`，必须排除） | 4 |
| 仓外路径（`/etc/nixos`、`/mnt/…`，记 unverifiable） | 2 |
| 当前 `anchor-drift` | 0 |
| `entries.json` | 3,370 B / 145 id |

## 边界

- `probe.mjs` 里的 ANCHOR 正则与扩展名白名单是 `retirement.ts` 的**复刻**（该常量未导出），
  所以它算出的「可绑定」是预估值；与真实 `anchorDriftReasons` 的一致性只在一个点上交叉验证过：
  两者对当前文档都报 **0 drift**。落地时按规格 §4.2 抽成共享 helper，届时这条复刻删除。
- 输出是单点快照；记忆文档一改，数字就变。
