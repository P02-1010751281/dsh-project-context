# 批次 L 载入验收（2026-10-06，用户重启后）

批次 L（`105868d` @ `2026-10-06T15:56:57+08:00`，
`fix(memory): the consolidation prompt asks for compression, not deletion`）在用户于普通终端跑
`/etc/nixos/scripts/dsh-desktop-restart.sh` 之后被验证为**已载入**。

判据不是任何写下来的 pid 或启动时间，而是下面这几条可重跑的检查。任何一条都不要凭本文件
的叙述采信，重跑即可。

## 1. 持有者启动晚于最后一个 `src/` 提交

```bash
ss -ltnp | grep 19387                        # LISTEN 127.0.0.1:19387 users:(("MainThread",pid=<pid>,fd=37))
ps -o lstart= -p <pid>                       # 本次验收时 <pid>=946379，起于 二 10月 6 16:44:52 2026
git log -1 --format='%cI %h %s' -- src/      # 2026-10-06T15:56:57+08:00 105868d fix(memory): …
```

观察：持有者启动时间**晚于** `105868d` 的提交时间；重启前的持有者（pid 851601，起于 15:06:39）
已消失。

## 2. `lib/` 就是提交的那份，且与全新编译一致

```bash
git diff --exit-code -- lib                  # 退出码 0
TMP=$(mktemp -d); node_modules/.bin/tsc --outDir "$TMP"
diff -rq lib "$TMP"                          # 只在 lib 中存在：client.js（esbuild 客户端包，非 tsc 产物）
```

## 3. 宿主实际加载的路径就是本仓库

```bash
readlink -f ~/.dsh/profiles/desktop/node_modules/dsh-project-context   # /mnt/Data/Projects/dsh-project-context
readlink -f ~/.dsh/profiles/web/node_modules/dsh-project-context       # /mnt/Data/Projects/dsh-project-context
```

## 4. 行为佐证：被加载的模块返回批次 L 的规则

```bash
node .agents/evidence/2026-10-06-batchL-load-verify/witness.mjs
```

`witness.mjs` 经上面那条 profile 路径 import 真正被宿主加载的
`lib/project-memory/consolidate.js`（本次解析到 `/mnt/Data/Projects/dsh-project-context/lib/...`），
断言：

- `memorySectionRule(40000)` 与 `memoryLossRetryRule([...], 0)` **都**包含 `MEMORY_KEEP_RULE`；
- 两者都**不再**匹配 `drop the least durable entr…`（批次 L 之前的收尾句）；
- 重试句包含 `apply the same ladder without sections`（无分区上限路径）；
- `MEMORY_SURVIVAL_CAPTION` 已导出且非空。

本次运行打印 `WITNESS: the loaded artifact carries batch L behaviour …`，退出码 0。

## 5. 同一次验收里的其它现值

```bash
grep '"version"' package.json                # 0.4.3
git tag -l --sort=-v:refname | head -1       # v0.4.3
git ls-remote origin 'refs/tags/v0.4.3*'     # tag 对象 18c1f9c + peeled 64d62d0
node .agents/evidence/2026-10-05-memory-share-fix-offline-verify/share-fit.mjs
                                             # sectionDropped 0 / droppedItems 0 / itemTruncated 0，往返逐字节一致
```

门禁同轮复跑：`pnpm typecheck` 0、`pnpm test` **395 pass / 0 fail**、`pnpm build` 0
（`lib/client.js` 28575 bytes），build 之后 `git diff --exit-code -- lib` 仍为 0。

## 边界

第 4 条证明的是**被加载的那份产物**在行为上携带批次 L；它不证明模型会遵守提示词——提示词是否
被遵守只能由真实整理会话观察，属于已记录的未证事项（`CONTEXT.md` Open tasks）。
