# Repository Guidelines

> 事实快照：2026-11-22。计数一律现读（`git ls-files lib | wc -l`、`ls test/*.mjs | wc -l`、
> `node --test 'test/**/*.test.mjs' | grep '^ℹ tests'`），不要引用旧数字。

## 1 在哪

- 仓库根：`/mnt/Data/Projects/dsh-project-context`。本包是 dsh 插件包：4 个 cordis 插件
  （`src/project-context`、`src/project-memory`、`src/project-autolearn`、`src/project-handoff`）
  加 1 张设置卡片（`client/`）。
- 结构、数据流、依赖方向：[docs/architecture.md](./docs/architecture.md)。规则：[RULES.md](./RULES.md)。
  术语：[docs/GLOSSARY.md](./docs/GLOSSARY.md)。文档索引：[docs/README.md](./docs/README.md)。用户手册：[README.md](./README.md)。
- 插件入口是 `src/<plugin>/index.ts` 的 `name` / `inject` / `apply`；子路径映射见 `package.json:8-30` 与 `cordis.patch.yml:8-16`。

## 2 怎么开工

1. 读 `RULES.md` 与 `docs/architecture.md`，再读 `docs/GLOSSARY.md` 确认用词。
2. `git status --short` 记录既有未提交改动（另一会话可能同时在改同一工作树）。
3. 改 `src/` 或 `client/` 前先跑 `pnpm typecheck` 取基线；确认要碰的文件不在他人写入范围内。

## 3 改动后跑什么

> 权威条文见 `RULES.md` 第 6 章；这里只回答「什么时候跑哪条」。

```bash
pnpm typecheck     # host + client 两半 --noEmit
pnpm build         # tsc → lib/**/*.js|d.ts，再 esbuild → lib/client.js
pnpm test          # 先 tsc，再 node --test 'test/**/*.test.mjs'
pnpm build:client  # 只重建 lib/client.js
pnpm docs:check    # 文档门禁：链接 / 锚点+符号 / 3.2 基线 / 4.2 白名单
```

- 改 `src/` / `client/` 必须带重建的 `lib/`；`git diff --exit-code -- lib` 为空。
- UI 改动要过 `test/card-render.test.mjs`（唯一真渲染）。文档改动跑 `pnpm docs:check`。
- 修复或新增行为要有具名用例；修复要做变异验证（改回原样该用例必须变红），用例名写进 `CHANGELOG.md` 未发布条目。

## 4 交付什么

> 提交与发布格式的权威条文见 `RULES.md` 第 8 章。

- 先结论后依据，附命令与真实输出；`path:line` 作为证据时带符号名（行号会漂；术语表模块锚点除外），
  如 `withMemoryLock（src/shared/lock.ts:213）`。
- 没有运行期证据就不写「已修复」「已生效」；生效按宿主进程启动时刻判定（`RULES.md` 10.4）。
- 提交用英文 Conventional Commits，一次一件事；只 stage 本任务路径，禁 `git add -A`；规则改动单独提交 `docs(rules)`。
- 收尾列出：改了什么、跑过什么（命令 + 退出码）、没覆盖什么。

## 5 不能碰什么

> 以下是摘要；权威条文在 `RULES.md` 第 10 章。

- 不手改 `lib/`：只由 `pnpm build` 生成。
- 不绕过插件写路径编辑 `.agents/memory/{MEMORY,CONTEXT}.md`；确需手改时用 `loadMemory` + `isMemoryTruncated` 复验。
- 不擅自重启宿主、不跑 `/memory update`（用户动作）。
- 不按评审散文直接改代码：先复现（探针或 API 读数）。
- 不改变规则语义；改规则按 `RULES.md` 第 2 章。

## 项目技能（触发 → 技能）

| 触发 | 技能 |
|---|---|
| 改状态核 / 回执 / 七态 | `.agents/skills/dsh-readonly-state-core-extension/SKILL.md` |
| 变异验证 | `.agents/skills/dsh-plugin-mutation-round/SKILL.md` |
| 评审后修一批 | `.agents/skills/dsh-plugin-review-fix-batch/SKILL.md` |
| 证明改动在宿主生效 | `.agents/skills/dsh-host-build-restart-verify/SKILL.md` |
| 记忆文档丢失修复 / 预算压缩 | `.agents/skills/dsh-memory-doc-loss-repair/SKILL.md`、`.agents/skills/dsh-project-memory-cap-guard/SKILL.md` |
| 发版 | `.agents/skills/dsh-project-context-release/SKILL.md` |
| profile 抬 pin | `.agents/skills/dsh-profile-sha-pin-lib-parity-verify/SKILL.md` |
| 多会话并发提交 | `.agents/skills/dsh-project-context-concurrent-writer-guard/SKILL.md` |
