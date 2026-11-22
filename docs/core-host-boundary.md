# 核心与宿主边界（shim）

> 2026-11-22。回答一句话：内部逻辑依赖哪个面、宿主 API 被关在哪一层、换一个 harness 时改哪里。
> 判据是 `pnpm boundary:check`，实现是 `scripts/check-boundary.mjs`。

## 1 分层

```
src/host/contract.ts        唯一可以 import 宿主包的文件（类型 + 两个纯事件判定函数）
src/host/dsh/services.ts    唯一出现 ctx.get(...) 的地方：把宿主服务读成窄接口
src/host/dsh/log.ts         ctx.logger → HostLog
src/host/dsh/llm.ts         ctx.llm → LlmPort（含回复流的 chunk 词表，不再借用宿主类型）
src/host/dsh/lifecycle.ts   ctx.effect → onDispose
src/<plugin>/index.ts       唯一允许 ctx.on / ctx.commands.register / ctx.systemPrompt.context 的接线文件
其余 src/ 文件               核心：不 import 宿主包、不读 ctx 服务
```

依赖方向：插件入口 → 核心模块 → `src/host/*`（contract + 视图）；`src/host/` 不反向依赖插件或
`src/shared/`。`client/` 是浏览器半边的展示适配层，仍直接依赖宿主客户端包，不在本门禁范围。

## 2 为什么不是「把类型全抄一遍」

`contract.ts` 目前是对宿主数据形状的**单一命名点**：`Session`（id / header / snapshotEvents）、`Agent`、
事件与 LLM 的请求/响应类型仍以宿主声明为准。这是有意的第一阶段——先把「谁可以提到宿主」收成一个文件，
再按需把形状换成自有的结构接口。收益已经可验证：

- 换宿主只需重写 `src/host/`（contract 的实现侧 + 四个视图），核心模块不改；
- 宿主 API 的每一处读取都有名字（`services.ts` 的 12 个 getter），不再散落在 8 个模块里；
- `ctx.logger` / `ctx.llm` / `ctx.effect` 各有窄接口，宿主方法签名变化只影响对应 shim。

第二阶段分三片，前两片已落地（2026-11-22）：

- **2a**：宿主类型搬进 `src/host/dsh/types.ts`，`contract.ts` 只 re-export、不再命名宿主包；门禁从
  「只有 contract.ts 可以」收紧成「只有 `src/host/<harness>/` 可以」。
- **2b**：`contract.ts` 现在**声明自有结构接口**（内容块、消息联合、事件信封、`Session` / `Agent`
  视图、辅助调用请求、投影面），零宿主 import；两处开放词表（块类型、事件类型）由适配器用宿主自己的
  `ContentBlockMap` / `SessionEventMap` 增补关闭，所以上游新增一种块或事件不需要改核心、也不会留下
  过期清单。独立审计（[证据](../.agents/evidence/2026-11-22-host-contract-audit/README.md)）：
  所有权成立；32 例谓词差分从 6 处不一致修到 0；并发现并修复了 `ownEvents()` 的隐藏读与一处
  写在适配器之外的 `declare module`。
- **2b 的已知残余（登记为 2d 候选，不在 2b 修）**：正向（核心 → 宿主）仍有两处方向不匹配——契约的
  `GenerateOptions` 不可赋给上游同名类型（`reasoningEffort` 放宽、消息形状不同），真实投影注册表
  不接受任意字符串键；两者今天分别由 `src/host/dsh/llm.ts` 的断言与通用服务 getter 遮住。彻底修法
  二选一：适配器逐字段构造宿主请求，或在入站边界包装每个宿主对象（`2d` 设计决定）。
- **2c（第一片已落地，2026-11-22）**：`HostContext` 声明在 `contract.ts`（`on` / `registerCommand` /
  `addPromptContext` / `onDispose` / `log` / `services`），实现是 `src/host/dsh/host-context.ts`；
  `project-context` 已按 `apply(ctx) → hostContextOf(ctx) → start(host)` 切开，入口 39 行、核心
  `start.ts` 377 行。其余三个插件未移植（它们的核心 helper 仍收整个 `Context` 去取日志、LLM 与服务，
  测试以假 context 调这些 helper 约 150 次），逐文件清单在
  [host-context-2c-design.md](./host-context-2c-design.md) §5。接第二个宿主前还缺四件：`HostContext`
  要有 `llm` 成员、`fiber.config` 设置读取要换成中性接口、服务 getter 要成契约接口、事件时序要写进
  契约（同文 §6）。

## 3 规则（`RULES.md` 4.6）

1. 只有 `src/host/contract.ts` 可以 import `@deepseek-ai/*`（`schemastery` 是库依赖，不在此列）。
2. 核心模块不得出现 `ctx.get` / `ctx.logger` / `ctx.llm` / `ctx.agents` / `ctx.skills` / `ctx.effect`。
3. `ctx.on` / `ctx.commands` / `ctx.systemPrompt` 只允许出现在 `src/<plugin>/index.ts`。
4. `src/host/` 不得 import `../project-*` 或 `../shared/*`。

判据：`node scripts/check-boundary.mjs` 退出码 0；`test/host-boundary.test.mjs` 钉住每条失败方向
（核心 import 宿主包、核心读服务、非入口注册、host 反向依赖、host 侧第二扇门）。

## 4 本批改动

| 面 | 之前 | 现在 |
|---|---|---|
| 宿主包 import | 30 个文件直接 import 5 个宿主包 | 只有 `src/host/contract.ts`；其余经它命名 |
| `ctx.get(...)` | 8 个模块共 22 处、各自 cast | `src/host/dsh/services.ts` 的 12 个 getter，按服务名分文件 |
| `ctx.logger` | 13 个文件 30 处 | `logOf(ctx)`（`HostLog`） |
| `ctx.llm` | 3 个文件 4 处 | `llmOf(ctx)`（`LlmPort`，含自有 chunk 联合） |
| `ctx.effect` | `shared/settings.ts` 直接调用 | `onDispose(ctx, …)` |
| `ctx.on` / `ctx.commands` / `ctx.systemPrompt` | 入口 + 无 | 仍只在 4 个 `index.ts`（门禁钉住） |

## 5 复验

```bash
pnpm boundary:check   # 113 个 src 文件，0 失败
pnpm docs:check       # 依赖表与 specifier 名单仍一致（host 层没有新增插件边）
pnpm typecheck
pnpm test
```
