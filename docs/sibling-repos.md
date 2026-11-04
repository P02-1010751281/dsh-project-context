# 同族仓库：dsh / pi / codex project-context

三个仓库做的是同一件事（项目级持久上下文：会话存档 → 记忆整理 → 技能沉淀 → 交接），
但宿主不同，实现形态与发布节奏完全不同。**它们各自独立，本仓库任何时候都不去改另外两个
的工作树**：需要上游事实时只读勘查，结论写回本仓库的 `docs/` 或记忆。

核对于 **2026-11-04**。下表所有会漂的值（HEAD、版本、文件数）都要现读，不要引用这里的快照：

```bash
for r in dsh-project-context pi-project-context codex-project-context; do
  printf '%-24s %s %s %s\n' "$r" \
    "$(git -C /mnt/Data/Projects/$r rev-parse --short HEAD)" \
    "$(git -C /mnt/Data/Projects/$r rev-parse --abbrev-ref HEAD)" \
    "$(git -C /mnt/Data/Projects/$r tag -l --sort=-v:refname | head -1)"
done
```

## 一览

| | dsh-project-context | pi-project-context | codex-project-context |
|---|---|---|---|
| 路径 | `/mnt/Data/Projects/dsh-project-context` | `/mnt/Data/Projects/pi-project-context` | `/mnt/Data/Projects/codex-project-context` |
| 远端 | `ssh://git@ssh.github.com:443/P02-1010751281/dsh-project-context.git`（Forgejo） | `git@github.com:P02-1010751281/pi-project-context.git`（GitHub） | `https://git.lentech.site/C02-1010751281/codex-project-context`（Forgejo） |
| 分支 | `main` | `master` | `master` |
| 语言/形态 | TypeScript，cordis 插件包（四个插件） | TypeScript，pi extension | **Python**：`hooks/context_hook.py`（370 B 入口）+ `scripts/contextctl.py`（单文件 ~93 KB） |
| 驱动方式 | dsh 的 `ctx` 事件与服务 | pi 的 host API | **Codex hook 协议**（`hooks/hooks.json`，命令式子进程） |
| 首次提交 | 2026-09-12 | 2026-09-12（从 pi 迁出） | 2026-09-17 |
| 跟踪文件 | 423 | 577 | 16 |

## codex-project-context 具体形态

- 插件根目录就是仓库根，没有 `plugins/` 套层；`.codex-plugin/plugin.json` 声明
  `skills: ./skills/` 与 `hooks` 两个 capability。
- `hooks/hooks.json` 挂了七个事件：`SessionStart`、`UserPromptSubmit`、`PostToolUse`、
  `PreCompact`、`PostCompact`、`Stop`、`SessionEnd`，全部执行
  `python3 "$PLUGIN_ROOT/hooks/context_hook.py"`。
- 数据流与本仓库同构：`.agents/memory/{MEMORY.md,CONTEXT.md,HANDOFF.md,memory.jsonl,session-logs/}`
  加 `.agents/skills/<name>/SKILL.md`，同为「memory.jsonl 是追加式权威源、MEMORY.md 是渲染产物」。
- 测试是 `tests/run_tests.py` + `tests/test_contextctl.py`（Python），不是 `node --test`。
- 没有 tag：版本只体现在 `.codex-plugin/plugin.json` 的 `version` 字段。

## 为什么不能混着改

三者的**写路径**（谁在什么事件上写哪个文件）完全不同，dsh 侧的不变量在另外两个仓里没有对应
实现。跨仓移植必须是显式的一批工作（先只读勘查、把差异写进 `docs/`、再单独动本仓库的
`src/`），不能在勘查过程中顺手改上游。
