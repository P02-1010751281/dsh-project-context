# 仓库元数据（About / Topics）

GitHub 仓库右栏 About 与 Topics 的文案与操作记录，改版后同步这里。

- 仓库：`P02-1010751281/dsh-project-context`
- License：MIT
- 核对时间：2026-09-12（当时 description 仍是旧文案「…driven by a shared autolearn pass」，
  topics 为空；新文案见下）

## Description（推荐粘贴）

英文（GitHub 搜索友好）：

```
dsh (DeepSeek Harness) plugins for project-level persistent context: session archive with a mechanical index, memory consolidation (CONTEXT.md + MEMORY.md), low-frequency skill autolearn, and automatic handoff.
```

中文备选：

```
DeepSeek Harness (dsh) 的项目级持久上下文插件包：会话存档（session.jsonl + 索引）→ 记忆整理（CONTEXT.md + MEMORY.md）→ 低频技能沉淀 → 自动交接。
```

## Topics

```
dsh
deepseek-harness
dsh-plugin
ai-agent
agent-memory
context-management
session-archive
skill-learning
autolearn
handoff
typescript
cordis
llm
```

说明：GitHub 上限 20 个 topic；`dsh` 单独搜索会撞 Dancer shell，因此与 `deepseek-harness`、
`dsh-plugin` 搭配使用。

## 网页操作

1. 打开 https://github.com/P02-1010751281/dsh-project-context
2. 右栏 **About** → 齿轮/铅笔图标（Edit repository details）
3. 粘贴 **Description**；**Topics** 逐个输入后回车；Website 留空
4. 勾选 **Releases**（已有 tag 如 `v0.2.0`，About 会显示 release 徽标）→ **Save changes**

## 命令行（需要 gh 已登录）

```bash
gh repo edit P02-1010751281/dsh-project-context \
  --description "dsh (DeepSeek Harness) plugins for project-level persistent context: session archive with a mechanical index, memory consolidation (CONTEXT.md + MEMORY.md), low-frequency skill autolearn, and automatic handoff." \
  --add-topic dsh --add-topic deepseek-harness --add-topic dsh-plugin \
  --add-topic ai-agent --add-topic agent-memory --add-topic context-management \
  --add-topic session-archive --add-topic skill-learning --add-topic autolearn \
  --add-topic handoff --add-topic typescript --add-topic cordis --add-topic llm
```

注意：`gh repo edit` 的 description 走 `PATCH /repos/{owner}/{repo}`，topics 是独立接口
`PUT /repos/{owner}/{repo}/topics`（`gh` 已封装）；裸 API 不要指望一次调用同时改两者。
