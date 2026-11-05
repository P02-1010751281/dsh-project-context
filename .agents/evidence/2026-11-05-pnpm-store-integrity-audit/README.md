# pnpm store 完整性审计（2026-11-05）

闭合的 open task：上一轮（`SH-1` 拆除）`pnpm install` 后 `zod@4.6.2` 缺 6 个文件、9 个测试文件
import 即崩，当时只补了已观测到的文件，**没有做全仓审计**，并把原因记为「`/mnt/Data` 是 NTFS，
其上的 pnpm store 会装出残缺包」。本轮把这两件事一次查清。

## 1. 方法

判据不是 `diff`，是**逐文件哈希比对**，且先证明「被比较的两份是同一构件」：

1. 从 `node_modules/.pnpm` 逐个读出 `name@version`（73 个包）。
2. 按 registry 拉 `name@version` 的 tarball。
3. 用 `pnpm-lock.yaml` 里的 `integrity` 校验该 tarball —— 不相等就说明比较基准不对，停止。
4. 解包后对每个文件比 `size` + `sha256`，分四类：缺失 / 内容不同 / 仅本地有 / 一致。

第 3 步是必需的：镜像可能返回与安装时不同的构件，那样「缺失」只是比较基准错了。

## 2. 我自己的两次假结论（都被交叉检查推翻）

| 假结论 | 为什么错 | 怎么发现 |
|---|---|---|
| 第一版用 `diff -rq` + `sed` 只匹配顶层，报 **73/73 OK** | `diff -rq` 对**嵌套**差异输出 `Only in <子目录>: <文件>`，顶层模式匹配不到；而且完全忽略了 `Files … differ`（内容截断正是这个形状） | 同一棵树上 `@deepseek-ai/dsh-package-manifest` 明明缺 `lib/index.js`，却报 OK |
| 「store 自身被截断」 | `pnpm store status` 报 `Packages in the store are untouched`；直接按 sha512 查 store，`lib/index.js`（`export {};\n`）与一份 LICENSE 的 blob **都在** | 见第 4 节 |

教训：`diff` 的嵌套 `Only in` 行与顶层行形状不同；一个「全绿」的审计器必须先在一个已知缺陷上开火。

## 3. 结果（修复前）

```
BROKEN: 1     @deepseek-ai/dsh-package-manifest@0.1.7-rc.2  missing lib/index.js
NOTES:  24    每个缺 LICENSE（doc 级，不影响运行时）
CLEAN:  48
```

- 唯一的代码缺陷是 `lib/index.js`，内容仅 11 字节 `export {};\n` —— 该包是纯类型包，所以**运行时影响为零**，
  但 `package.json` 的 `main` / `exports["."]` 都指向它，直接 `import` 该包会 `ERR_MODULE_NOT_FOUND`。
- 24 个 `@deepseek-ai/dsh-*` 缺 LICENSE，其余 scoped/unscoped 包（`cordis`、`cosmokit`、`zod`）都在。
- `esbuild@0.28.2` 的 `bin/esbuild` 本地 11 MB、上游 9 KB：**预期**，esbuild 自身 postinstall 用平台
  二进制替换 JS shim，不是缺陷，已单独分类不混进代码判定。

## 4. 层次判定：store 完好，丢在链接环节

三条独立证据：

1. `pnpm store status` → `Packages in the store are untouched`。
2. 按 sha512 定位 store 内容：`files/4e/e1c88f…` 存在且正是那 11 字节；`dsh-llm` 的 LICENSE blob 也在。
3. 锁文件 `integrity` 与重下的 tarball **逐字相等**（`dsh-package-manifest` / `dsh-llm` / `cosmokit` /
   `zod` / `typescript` / `react` 六个全对）—— 排除「镜像给了不同构件」。

所以先前那条记忆表述不准确：不是「store 会装出残缺包」，而是 **store → `node_modules` 这一步丢了文件**。
具体机制未定位（NTFS 上 hardlink 失败后静默跳过是候选，未证实）。

## 5. 修复与复验

从第 3 步校验过的 tarball 恢复 26 个文件（1 个代码文件 + 25 个 LICENSE），然后整轮重跑：

```
BROKEN: 0   NOTES: 0   CLEAN: 73
VERDICT: NO CODE DEFECTS — every upstream source file present and byte-identical
```

门禁（修复后）：`pnpm typecheck` exit 0；`pnpm test` **477/477**；`pnpm build` exit 0，
`built ./lib/client.js (28575 bytes)`（与修复前一致）；`git status --short lib/` 为空。

## 6. 残留

- 恢复只作用于 `node_modules/.pnpm`，**不入 git**：下一次 `pnpm install` 若再丢文件，必须重跑本审计。
  store 完好，所以重装**可能**自行修好，但没有证据保证不再丢。
- 丢文件的触发机制未定位。79 个包只丢 25 个文件、且集中在 `@deepseek-ai/dsh-*` 的 LICENSE 与一个
  11 字节模块，更像「内容极短或高度重复的文件被跳过」而不是随机截断 —— 未验证，不作为结论。
- 审计范围仅限**本仓库**的 `node_modules`；全局 store 的其他内容未按包逐一比对。

## 7. 复现

```sh
cd /mnt/Data/Projects/dsh-project-context
mkdir -p /tmp/pnpm-store-audit

# 1) 包清单 -> name<TAB>version<TAB>安装目录
node -e '...' > /tmp/pnpm-store-audit/packages.tsv   # 见 compare.mjs 顶部说明的字段

# 2) 校验 tarball 与锁文件 integrity（务必先跑，否则比较基准未经证明）
# 3) 全量哈希比对
node .agents/evidence/2026-11-05-pnpm-store-integrity-audit/compare.mjs
# 4) 只恢复被判定缺失的文件（源为第 2 步校验过的解包目录）
node .agents/evidence/2026-11-05-pnpm-store-integrity-audit/restore.mjs
```

两个脚本都假设工作区在 `/tmp/pnpm-store-audit`（`packages.tsv`、`cache/`、`extract/`、`audit-result.json`），
`restore.mjs` 只拷贝 `compare.mjs` 判定为缺失的文件，并且在源文件不存在时直接报错拒绝，不会凭空造文件。
