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
| 条目 | 145（其中 82 条在当前文档上带 id） |
| 可绑定条目 | **12** |
| 可绑定文件 | **12 个，合计 171.3 KB**（最大 `src/project-memory/sections.ts` 32.9 KB） |
| 自引用 / 生成物（`.agents/memory/*`、`lib/*`，排除） | 4 / 4 |
| 仓外路径（`/etc/nixos`、`/mnt/…`，不绑） | 2 |
| 当前 `anchor-drift` | 0 |
| `entries.json` | 3,370 B / 145 id |

## 边界

- **实现后已无复刻**：`probe.mjs` 现在直接调用 `lib/project-memory/staleness-source.js` 的
  `bindableAnchors`，测的就是发布规则；`classify.mjs` 是落地前的旧探针，保留作对照。
- 数字从 34 变成 12 有两个原因，都是实现时才暴露的：`lib/` 被排除（构建产物），以及
  **只有带 id 的条目能绑定**（145 条里 82 条带 id）。
- 输出是单点快照；记忆文档一改，数字就变。
