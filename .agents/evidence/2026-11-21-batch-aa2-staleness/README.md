# Batch AA2 预检：内容漂移的规模与精度（2026-11-21）

只读预检，回答三个问题：**当前有多少条目真的有源文件绑定、其中多少条已漂移、漂移里有多少条是真的失真**（后者决定「能不能自动退役」）。

## 怎么跑

```bash
node probe.mjs > output.txt
```

从 `lib/` 导入**构建产物**（`readEntrySidecar`、`sectionsFromMarkdown`、`entryTid`、`measureStaleness`），不是 `src/`；改过 `src/` 需先 `pnpm build`。
逐条明细由探针自己重算（sha256 前 16 hex），因为 `StalenessFacts.staleIds` 只保留前 3 个 id（`staleness.ts:60`）。

## 结论（2026-11-21T18:18+08:00 现读）

| 项 | 值 |
|---|---:|
| `MEMORY.md` | 51,996 字符 / 52,000 上限（**99.99%**） |
| 条目 | 152 |
| 有文件绑定 | **25** |
| 内容漂移（`stale`） | **6** |
| 文件消失 / 不可读 | 0 / 0 |

6 条漂移：`ef8` → `retirement.ts`、`dc5` → `model-call.ts`、`af0` → `perform.ts`、`b5b` → `docs/README.md`、`bde` → `test/logic.test.mjs`、`0ac` → `docs/memory-rewrite-loss-gate-spec.md`。

## 读法

- **精度 1/6**：只有 `ef8` 因为 AA1a 让 `retireSections` 改为向 `entryStateOf` 提问而失真；其余五条只是被引用文件因无关改动而重写。
  这是「漂移的引用文件变了」与「事实不成立」之间的实测距离，也就是**不能自动退役**的理由。
- **基线永不刷新**：`bindAndMeasure` 对正文未变的条目逐字节保留旧基线（`staleness-source.ts:164-180`），
  所以一条被确认仍成立的条目会永远以 `stale` 出现——`stale N` 随时间是单调的，通道必须提供显式再基线。
- 自动通道（85% 阶梯）今天每次 pass 都带着，与漂移无关：它只看字符占用。

## 边界

探针只读 `.agents/memory/` 与它引用的仓库内文件；`lib/` 被 `.gitignore` 屏蔽的生成物（`lib/`）本来就不被绑定（`GENERATED_PREFIXES`）。
