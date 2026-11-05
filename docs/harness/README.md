# 三 harness（dsh / pi / codex）：状态机、接口面与接入决定

同一件事——项目级持久上下文（会话存档 → 记忆整理 → 技能沉淀 → 交接）——在三个宿主上各有自己的
**状态推进方式**和**扩展契约**。这里按宿主分文件登记，不写成一个混合文档。

| 文件 | 内容 |
|---|---|
| [dsh.md](dsh.md) | dsh（本仓库）的生命周期、状态机、63 个事件、9 个服务、注入与命令 |
| [pi.md](pi.md) | pi 的状态机、41 个事件、33 个方法、返回值契约 |
| [codex.md](codex.md) | codex 的 7 个 hook、三种输出协议、落盘状态机 |
| [integration.md](integration.md) | **决定**：我们接哪些接口、哪些是真 shim、哪些是分类错误 |

本文只放**跨三边的东西**：语义对照表、登记协议、复核命令。三仓归属与远端见
[sibling-repos.md](../sibling-repos.md)。

---

## 1. 一句话差异

| | dsh | pi | codex |
|---|---|---|---|
| 扩展形态 | cordis 插件，**进程内** | pi extension，**进程内**，只能有一个 | **命令式子进程**，每个 hook fork 一次 |
| 注入 | **拉取式**（装配时求值） | **推送式**（事件里给文本） | **推送式**，3000 字符上限 |
| 事件面 | 63 个，我们注册 6 个 | 41 个，扩展注册 6 个 | 7 个 hook，全用 |
| 辅助模型 | `ctx.llm.stream` | `modelRegistry.complete` | **无**（0 处网络调用） |
| 跨事件状态 | 进程内可持有 | 进程内，但必须在同一扩展内 | **只能落盘** + `file_lock()` |
| 失败姿态 | `warn` / 退避 | catch，不阻塞 | 静默 `print("{}")`，绝不阻塞 |

**最后一行是设计前提，不是细节**：codex 的 hook 失败必须静默，所以它把每次调用都当首调，
所有「记住上次」都变成磁盘状态机。

---

## 2. 跨边语义对照

同一个概念在三边不叫同一个名字，也不在同一个时刻发生。这张表是「统一实现」时唯一必须逐行确认的东西。

| 概念 | dsh | pi | codex |
|---|---|---|---|
| 会话开始 | `agent/created` + `session/event` | `session_start` | `SessionStart`（带 matcher） |
| 模型调用前 | prompt 装配时**拉取** provider | `before_agent_start` 推送 | `UserPromptSubmit` |
| 一轮结束 | `session/event` `type === "turn/end"` | `turn_end` / `agent_settled` | `Stop` |
| 空闲/稳定 | `agent/status` | `agent_settled` | `Stop` |
| **压缩前** | **没有这个钩子** | `session_before_compact`（返回 `{cancel:true}`） | `PreCompact`（写 `HANDOFF.md`） |
| 压缩后 | — | — | `PostCompact` |
| 关闭 | `session/flush` + `session/disposed` | `session_shutdown` | `SessionEnd` |
| 工具调用后 | `tools/post-execute`（未接） | `tool_call` / `tool_result` | `PostToolUse` |
| 注入通道 | `systemPrompt.context`，**无字符上限** | `before_agent_start` 的 `systemPrompt`，另有 `context` / `context_with_system` | `additionalContext`，**3000 上限** |
| 辅助模型 | `ctx.llm.stream` | `modelRegistry.complete` | **无** |
| 用户命令面 | `commands.register` | `registerCommand` | 无（hook 协议没有命令面） |
| 开关粒度 | profile 设置 | `--no-project-context`（单次运行） | 配置键 `codexHookEnabled` 等 |

### 三条不能想当然的差异

1. **压缩前钩子在 dsh 不存在**。dsh 只有 `compaction/summary-error`，压缩由 dsh 自己的服务驱动。
   所以 pi / codex 的「压缩前取消或写 handoff」逻辑**无法平移到 dsh**——dsh 侧只能靠 `turn/end`
   上的阈值判断。这不是实现选择，是结构差异。
2. **整理由谁执行**：dsh / pi 调辅助模型；codex 让**宿主 agent 自己**去跑维护命令。这决定了
   「整理失败」在三边的归因完全不同（模型失败 / 扩展异常 / 宿主没执行命令）。
3. **跨事件状态**：dsh / pi 有进程内状态；codex 每次都是新进程，状态必须落盘并用文件锁串行化。

---

## 3. 落盘契约（唯一真正共享的东西）

```
.agents/memory/{MEMORY.md, CONTEXT.md, HANDOFF.md}   # 渲染产物
.agents/memory/memory.jsonl                          # 追加式权威源（dsh / pi）
.agents/memory/session-logs/INDEX.md + <session>/     # 会话存档
.agents/skills/<name>/SKILL.md                       # 技能沉淀
```

差异：codex 额外有 `session-logs/<session>/maintenance-request.json` 与 `session-state.json`
（子进程状态机的落盘）、`skill-candidates/`、`errors.log`（带轮转与脱敏）。dsh / pi 的等价状态在内存里。

---

## 4. 复核命令（现读，别信本文的计数）

本文所有数字都会漂。要写「现在是多少」，跑这些命令，别引用上面的表格。

```sh
# ---------- dsh ----------
# 我们注册了哪些事件（应为 6 个不同名）
grep -rhoE 'ctx\.on\("[a-z/]+"' src/ | sort | uniq -c

# 我们读了哪些未声明服务
grep -rnoE 'ctx\.get\("[a-zA-Z]+"\)' src/ | sed 's/.*ctx.get("//;s/")//' | sort | uniq -c

# 注入 / 命令注册点
grep -rn 'ctx\.systemPrompt\.context(\|ctx\.commands\.register(' src/

# 确认我们没有注册 tools/pre-execute（应为 0）
grep -rn 'pre-execute' src/ || echo "0 hits"

# dsh 自己的完整事件面（需要运行中的 store 路径）
D=$(ls -d /nix/store/*-dsh-desktop-0.*/lib/dsh-desktop/repo | sort -V | tail -1)
grep -rhoE "'[a-z]+/[a-z-]+'[[:space:]]*\(" $D/packages/*/*/lib/types/*.d.ts \
  | grep -oE "'[a-z]+/[a-z-]+'" | tr -d "'" | sort -u | wc -l

# session/event 能收到哪些类型
sed -n '/export interface SessionEventMap/,/^}/p' $D/packages/core/session/lib/types/types.d.ts \
  | grep -oE "^\s+'[a-z/-]+':" | tr -d " ':" | sort

# ---------- pi ----------
P=$(readlink -f "$(command -v pi)")
P=$(readlink -f "$(dirname "$(dirname "$P")")/lib/pi/node_modules/@earendil-works/pi-coding-agent")
# pi 的完整事件面（应约 41 个）
grep -cE '^\s+on\(event: "' $P/dist/core/extensions/types.d.ts
# pi 的方法面
awk '/^export interface ExtensionAPI/,/^}/' $P/dist/core/extensions/types.d.ts \
  | grep -oE '^\s{4}[a-zA-Z]+' | tr -d ' ' | sort -u | wc -l
# 扩展实际注册的事件
grep -rhoE 'pi\.on\("[a-z_]+"' /mnt/Data/Projects/pi-project-context/extensions/project-context/ \
  | sort | uniq -c
# 顺序敏感的注册顺序
grep -n 'registerArchive\|registerConsolidation\|registerAutolearn\|registerHandoff' \
  /mnt/Data/Projects/pi-project-context/extensions/project-context/index.ts

# ---------- codex ----------
# 七个 hook 的 matcher 与超时
python3 -c 'import json;d=json.load(open("/mnt/Data/Projects/codex-project-context/hooks/hooks.json"));print({k:[(h.get("matcher"),h["hooks"][0].get("timeout"),h["hooks"][0].get("additionalContextLimit")) for h in v] for k,v in d["hooks"].items()})'
# 零模型/网络调用（应为 0）
grep -cE 'requests\.|urllib|httpx|openai' /mnt/Data/Projects/codex-project-context/scripts/contextctl.py || true
# codex 二进制自身是否承认这些协议字段
C=$(readlink -f "$(command -v codex)")
for s in hook_event_name additionalContext stop_hook_active additionalContextLimit; do
  printf '%-24s %s\n' "$s" "$(grep -ac "$s" "$C")"
done
```

---

## 5. 登记协议

1. **新接口**：先在对应宿主文件（[dsh.md](dsh.md) / [pi.md](pi.md) / [codex.md](codex.md)）的
   接口面表里确认它与现有条目的关系，再到 [integration.md](integration.md) §2 记录**决定**
   （接 / 不接）与理由。
2. **新 shim**：必须同时写**拆除条件**；没有拆除条件的 shim 不收。分类之前先问：用的是文档化
   选项吗？是的话它不是 shim。
3. **不写行号、不写文件计数、不写版本号**。要写「现在是什么」，就写读取它的命令，放进 §4。
4. 改动任何一边的接口面时，同一次提交里更新对应文件；只改代码不改这里视为未完成。

---

## 6. 本文不覆盖

- **不判断该不该统一**：三个仓各自独立发布、各有测试与发布约定（见
  [sibling-repos.md](../sibling-repos.md)）。要不要合并实现是另一份 spec 的事。
- **不枚举上游事件全集之外的东西**：只登记我们接入或明确不接入的面。
- **不记录行为细节**：每条规则的行为语义留在 `MEMORY.md` 的 Invariants。
