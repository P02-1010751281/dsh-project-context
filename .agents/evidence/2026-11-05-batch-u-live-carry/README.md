# 批次 U 的上线证据：carry 行三态在真实种子里是什么样（2026-11-05）

批次 U（`27c8c27`，2026-10-26 17:27:11）给交接种子加了恒在的 carry 行，三态由
`handoffSplit` 实际产出的尾料决定：`continuationCarried`（原文带入）/ `continuationTrimmed`
（带入了，但某条消息在渲染上限被裁）/ `continuationNothing`（什么都没带）。
`2026-10-26-handoff-carry-20000/` 只是**离线**见证（它自己的 README 结尾写着「未在线」）。
这份记录补的是上线那一半：**正在跑的宿主写出的真实种子**长什么样。

## 判据

唯一的生产表面是宿主写进新会话的种子，所以证据只取会话存储里的**原始首条用户消息**，
不取任何转述：

1. 种子的第 2 行（`continuationPreamble` 之后那行）必须**逐字节等于**三态之一，
   而这三条字符串从**构建产物** `lib/project-handoff/language.js` 里抽出来，不手抄；
2. 文案必须与种子正文自洽：`trimmed` 声称「某条消息在渲染上限被裁」，
   而 `clip()` 裁剪时会追加 `[...truncated...]`，所以 `trimmed` 种子里必须至少有一处；
   反过来 `carried` 声称原文带入，正文里就不该有这处标记。

## 前提（现读，不引用快照）

- 宿主 pid 250828 启动于 **2026-11-05 09:53:41**，晚于批次 U 的 `language.ts` 改动
  （2026-10-26 17:27:11）与最后一个 `src/` 提交 `e3459c6`。
- `lib/project-handoff/language.js` 的中文三态与 `src/project-handoff/language.ts` 一致
  （探针运行时会打印它抽到的三行）。
- 扫描范围：`~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--` 下所有
  `session.v4.jsonl.zstd`，共 141 个交接种子。

## 结果（`scan-output.txt` 是现跑输出）

| 队列 | 数量 | carry 行 |
|---|---|---|
| 批次 U 之前的种子 | **130** | **完全没有这行**（阴性对照：第二行是 verify 行） |
| 批次 U 之后的种子 | **11** | 全部 `trimmed` |
| 其中在**当前宿主**下产生 | **3** | 全部 `trimmed` |

- 时间分界很紧：批次 U 提交于 17:27:11，最早的 `trimmed` 种子是 **17:29:44**（+2 分 33 秒）。
- 交叉校验：11 个 `trimmed` 种子里 `[...truncated...]` 出现 11–23 次，**0 条缺见证**；
  `carried` 出现 0 次，所以「carried 却带裁剪标记」这一类也无从发生。
- 当前宿主下的三个证据：`09:59:08`（`session-63f3ffa9…`）、`10:30:54`（`session-b19f942e…`，
  即上一会话）、`10:58:25`（`session-03d84b78…`，即写这份记录的本会话）。

## 负控制（运行 `scan.py` 的六种调用，退出码按因分）

| 场景 | 期望 | 实测 |
|---|---|---|
| 真实存储 + 宿主启动时间 | PASS | **0** |
| 篡改 `lib/` 里的 trimmed 文案 | 行不匹配 | **12** |
| 构造「trimmed 行但正文无裁剪标记」 | 文案与正文不符 | **13** |
| 构造「carried 行但正文有裁剪标记」 | 文案与正文不符 | **14** |
| 空存储（一个种子都没有） | 无 post-batch 种子 | **11** |
| 宿主启动时间晚于所有种子 | 运行中的宿主没产出 | **15** |

夹具由 `fixtures.py` 生成（写到 `/tmp/u-fixtures`），篡改的 `lib` 是 `/tmp/fake-language.js`。
六条路径都真的开火了，PASS 不是脚本唯一会打印的东西。

## 没观测到的两态（不是缺陷，是可达性）

- `carried`：0/11。尾料里只要有一条工具结果超过 1500 字符（`clip` 的 cap）就会走 `trimmed`，
  而真实会话里这几乎总成立。它仍可达（离线探针覆盖），只是生产样本里没撞上。
- `nothing`：0/11，且在当前配置下**不可达** —— 两个 profile 都是
  `handoffBudgetRecentTokens: 20000`，只有用户把预算改成 `0` 才会渲染这一态。
  这一态的证据仍由离线探针（`2026-10-26-handoff-carry-20000`）承担。

所以这份记录只把**上线**结论限定在 `trimmed` 一支：真实宿主确实按尾料的裁剪事实选了
`trimmed`，而不是恒说一句「已带入」。

## 一个必须记住的判据陷阱

**展示层文本不等于 store 原文。** 本轮实测：桌面界面交给模型的横幅把 carry 行显示成
「已原文带入，用于保持连续性；过长的单条消息按渲染上限裁剪…」（carried 的前半句 + trimmed 的后半句），
而同一会话 store 里的原始种子是干净的 `continuationTrimmed`。
两者都不在 `src/`/`lib/` 的任何字符串里。所以任何关于种子的判断都必须读
`session.v4.jsonl.zstd`，不能读对话窗口里被重排过的文本。

## 复核命令

```sh
cd /mnt/Data/Projects/dsh-project-context

# 前提：宿主启动时间与批次 U 的先后
ps -eo pid,lstart,cmd | grep 'dsh-desktop-host/lib/index.js' | grep -v grep
git log --format='%h %ci %s' -1 27c8c27

# 主判定（真实存储 + 宿主启动秒数）
python3 .agents/evidence/2026-11-05-batch-u-live-carry/scan.py --host-start 1793843621

# 负控制（期望依次为 12 / 13 / 14 / 11 / 15）
python3 .agents/evidence/2026-11-05-batch-u-live-carry/fixtures.py /tmp/u-fixtures
python3 .agents/evidence/2026-11-05-batch-u-live-carry/scan.py --lib /tmp/fake-language.js --host-start 1793843621; echo $?
python3 .agents/evidence/2026-11-05-batch-u-live-carry/scan.py --root /tmp/u-fixtures/trimmed-no-witness --host-start 1793843621; echo $?
python3 .agents/evidence/2026-11-05-batch-u-live-carry/scan.py --root /tmp/u-fixtures/carried-with-witness --host-start 1793843621; echo $?
python3 .agents/evidence/2026-11-05-batch-u-live-carry/scan.py --root /tmp/u-fixtures/empty-store --host-start 1793843621; echo $?
python3 .agents/evidence/2026-11-05-batch-u-live-carry/scan.py --host-start 1999999999; echo $?
```

`/tmp/fake-language.js` 的构造：把 `lib/` 的那份拷到 `/tmp`，把 trimmed 文案里的
「裁剪」改成「裁减」。

## 范围与残留

- 只扫了本工作区的存储目录；其他工作区的种子未扫（同一插件、同一构建，但没有样本）。
- 样本全是中文种子；英文三态没有生产样本（`language.ts` 的英文块与中文块同源，未被样本覆盖）。
- 判据读的是 `createdAt` 与文案，不证明每次 `handoffSplit` 的 `clipped` 计算都正确 ——
  重复性由离线探针与 `test/handoff-carry.test.mjs` 承担。
