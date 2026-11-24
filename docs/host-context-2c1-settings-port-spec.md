# 接第二宿主 2c-1 规格：把设置发布从 `fiber.config` 解耦成宿主中立的端口

> 事实快照：2026-11-24T15:20+08:00（Asia/Shanghai）。下面每个数字都用 §2 的命令现读过，引用前重读。
> 上游基线：`devDependencies` 钉 `0.1.7-rc.2`，本机运行线 `0.2.2-rc.5`。
> 本文只写规格：落地批次改 `src/`、`src/host/`、`test/` 与 `lib/`，本文件本身不改代码。

## 0. 结论速查

1. 这条是 `docs/host-context-2c-design.md` §6 的第 2 条（Settings publication）。
2. 违规事实：`src/shared/settings.ts:24` 直接 `import { onDispose } from "../host/dsh/lifecycle.js"`，
   而 §2 的分层只说「`src/host/` 不得反向依赖插件或 shared」。反向那条（shared → host/dsh）**门禁不查**，
   所以它一直绿着（§2 有判据）。注意 `shared → host/contract` 在这份树里是**普遍现象**（10 处），
   其中 4 处是值导入；所以本批新增的门禁必须只针对 `../host/dsh/`（适配层），不能一刀切禁 `../host/`。
3. 第二个耦合点在同一个文件的 `publishProjectContextSettings`：它从
   `(ctx as { fiber?: { config?: unknown } }).fiber?.config` 读实时配置。这是 cordis Loader 的形态，
   第二个宿主没有对应物，所以必须换成一个由适配层提供的**读数器**。
4. 形状：`HostPorts` 加一个只读成员 `settings`（`SettingsPort`），dsh 适配层用今天的
   `fiber.config` 实现它；四个插件继续经 `effectivePluginConfig(entry)` 读，签名不变、
   28 个调用点一个都不改（§3）。
5. 解耦的同时**删掉那条违规 import**：`publishProjectContextSettings` 收的本来就是 `ctx`，
   把 `onDispose` 的调用换成 `HostContext.onDispose`（它已经存在），shared 一侧就不必再认识 `ctx.effect`（§3.2）。
6. 门禁同时补一格：`check-boundary.mjs` 加「`src/shared/` 不得 import `../host/dsh/`」的判据，
   并**用现有的 `settings.ts:24` 做正控制**——不修它门禁必红（§5）。
7. 不改行为：`fiber.config` 的读法、`resolvePluginConfig` 的回退、disposal 时的清除语义逐条保持；
   `test/settings-form.test.mjs` 与 `test/card-render.test.mjs` 按原样通过是判据之一（§6）。

---

## 1. 今天这条依赖长什么样

### 1.1 两个耦合点

`src/shared/settings.ts` 里只有两处碰到宿主：

| 位置 | 内容 | 为什么是耦合 |
|---|---|---|
| `:24` | `import { onDispose } from "../host/dsh/lifecycle.js"` | `src/shared/` 直接依赖 dsh 适配层；第二个宿主没有 `lifecycle.js`，该模块编不出来 |
| `:102` | `(ctx as { fiber?: { config?: unknown } }).fiber?.config` | 读的是 cordis Loader 的 `Fiber.config`；第二个宿主的「实时配置」不在 `fiber` 上 |

`onDispose` 本身不复杂（`src/host/dsh/lifecycle.ts` 把 `ctx.effect` 或同义 API 包一层），
问题只在**位置**：`shared` 层不应知道它来自哪。

### 1.2 谁在用

- `publishProjectContextSettings`：**1 个调用点**，`src/project-context/index.ts:37`。
- `effectivePluginConfig`：**28 个调用点**，分布在四个插件的 `start.ts` / `command.ts` /
  `index.ts` 与 `src/project-handoff/command.ts`。这 28 处**一处都不用改**——它们只要求
  「给一个 fallback，还我一个当前生效值」，与配置从哪读无关。

### 1.3 分层现状（为什么现在没人拦）

`docs/architecture.md` §2 的原文是「`src/host/` 不得反向依赖插件或 shared」，
`scripts/check-boundary.mjs:102-106` 也只实现这一条（`inHost` 分支）。
**没有**任何一条检查 `src/shared/` 是否 import 了 `../host/`。所以 `settings.ts:24` 是
一条真实存在、但门禁看不见的边；`docs/architecture.md` §2 的边表也自然不会列它。

---

## 2. 现读判据（跑一遍确认上面每一句）

```bash
cd /mnt/Data/Projects/dsh-project-context
grep -rn "from \"\.\./host/dsh/" src/shared/     # 只应有 settings.ts:24 一条
grep -rn "from \"\.\./host/" src/shared/         # 共 10 条，其余 9 条都是 contract.js（类型或已存在的值导入）
grep -rn "\.fiber" src/ --include=*.ts           # 只有 settings.ts:102 是真读，另两条在注释里
grep -rn "effectivePluginConfig(" src/ --include=*.ts | grep -v "export function" | wc -l   # 28
grep -rn "publishProjectContextSettings(" src/ --include=*.ts | grep -v "export function" | wc -l  # 1
node scripts/check-boundary.mjs                  # 现在 0 失败——正是缺口
```

反证（**已实测**，2026-11-24）：把 `src/shared/settings.ts:24` 的
`../host/dsh/lifecycle.js` 改成 `../host/dsh/nonexistent.js`，结果

```
node scripts/check-boundary.mjs   →  boundary check: 126 source file(s), 0 failure(s)   （仍绿）
pnpm exec tsc --noEmit            →  error TS2307: Cannot find module '../host/dsh/nonexistent.js'
```

即：今天拦住这条边的**只有类型解析**，分层规则完全没看见它。这不是「顺带的小瑕疵」——
它意味着任何一次「路径写得通、语义却跨层」的改动都能通过全部门禁。快照
`/tmp/settings-probe.bak` 的 sha256 为 `a71c753c…`，探针后已按哈希校验还原。

---

## 3. 目标形状

### 3.1 契约新增一个端口

`src/host/contract.ts`，放在 `ServiceHost` 附近：

```ts
/**
 * Live plugin settings, as the host currently resolves them.
 *
 * The value is read on use, never captured: a settings write that touches only volatile fields is
 * committed into the running entry without a restart, so a snapshot taken at apply time would leave
 * the card's writes visible in the form and inert everywhere else.
 */
export interface SettingsPort {
	/** The settings this plugin's own entry currently resolves to, or `undefined` when unreadable. */
	current(): unknown;
}
```

`HostPorts` 增加 `readonly settings: SettingsPort;`（与 `log` / `services` / `llm` 并列）。

**为什么返回 `unknown` 而不是 `PluginConfig`**：`PluginConfig` 属于 `src/shared/config.ts`，
而 `contract.ts` 是宿主中立层，不该认识某个插件域的类型；解析仍是 `resolvePluginConfig` 的职责，
放在 `shared` 一侧。第二个宿主只需实现「把它的当前配置原样交出来」。

### 3.2 `settings.ts` 改写

```ts
export function publishProjectContextSettings(host: HostPorts, entry: PluginConfig): void {
	const token = ++owner;
	live = () => {
		let resolved: unknown;
		try {
			resolved = host.settings.current();
		} catch {
			return entry;
		}
		if (resolved === undefined) return entry;
		try {
			return resolvePluginConfig(resolved);
		} catch {
			return entry;
		}
	};
	host.onDispose(() => {
		if (owner !== token) return;
		live = undefined;
	}, "project-context: settings namespace");
}
```

三处语义逐条保持，写在实现旁边：

1. `current()` 抛错 → 回落到 `entry`（今天 `.fiber?.config` 取不到同理）。
2. 解析失败 → 回落到 `entry`（今天 `catch { return entry }`）。
3. 只有最新那次发布能清除 `live`（`owner !== token` 判据原样保留）。

`src/shared/settings.ts` 删除 `import { onDispose } from "../host/dsh/lifecycle.js"`，
并把第三段改成 `host.onDispose(...)`——`HostContext.onDispose` 与今天的 `onDispose(ctx, ...)`
做的是同一件事（`src/host/dsh/host-context.ts` 的该方法就是转调 `src/host/dsh/lifecycle.ts`），
所以调用一个 façade 方法即可，`shared` 侧不再需要认识 `ctx.effect`。
改完后 `shared` 对 `host` 的依赖只剩 `import type`（`../host/contract.js`），与其余 9 处一致。

`src/shared/lifecycle.ts` **不参与本批**：它装的是 `isTopLevel` / `SerialQueue` / `SessionWorkTracker`
这类纯逻辑，已经只依赖 `import type { Session }`，是合法的 shared 模块。不要为了「生命周期」
这个名字把 `onDispose` 塞进去——`onDispose` 要碰 `ctx.effect`，那是适配层的事。

### 3.3 dsh 适配层实现它

`src/host/dsh/host-context.ts` 的 `hostContextOf` 加一个成员：

```ts
get settings(): SettingsPort {
	// Read on use: a volatile-only settings write mutates the running fiber's references in place.
	return { current: () => (ctx as { fiber?: { config?: unknown } }).fiber?.config };
}
```

`project-context/index.ts` 的 apply 从

```ts
publishProjectContextSettings(ctx, entry);
start(hostContextOf(ctx), entry);
```

改为先建 façade、再发布：

```ts
const host = hostContextOf(ctx);
publishProjectContextSettings(host, entry);
start(host, entry);
```

顺序要求写进注释：**发布必须在 `start` 之前**，否则 `start` 里第一轮读到的还是 `entry`。
今天两者没有依赖，是因为 `publish` 只写模块级的 `live`；改后仍无依赖，但顺序要固定下来。

### 3.4 被否的两个形状

- **让 `effectivePluginConfig` 收一个 reader 参数**：28 个调用点全都要改，而且每个调用点都不关心
  配置从哪来——把宿主细节推到 28 处，换来一个更长的签名。拒绝。
- **在 `contract.ts` 里直接声明 `PluginConfig`**：把插件域的类型塞进中立层，第二个宿主也要
  照抄我们 23 个键的形状。拒绝，理由见 §3.1 末段。

---

## 4. 第二个宿主需要写什么（这条解耦换来的东西）

第二个适配器实现 `SettingsPort.current()` 时只有两种合法答案：

1. 它的配置中心能给出「该插件当前生效的整份配置」→ 原样返回；
2. 它没有热更新 → 返回 `undefined`，`shared` 一侧自动回落到 apply 时那份 `entry`。

第 2 种是**合法降级**：卡片写入要等重启才生效，但不会读错值、不会静默变成另一份配置。

---

## 5. 门禁要补的一格（本批的真正价值）

`scripts/check-boundary.mjs` 增加反向判据：

```
src/shared/<file>.ts  import "../host/dsh/..."  →  FAIL layering（`../host/contract.js` 不在此列）
```

实现细节三条：

1. **只禁 `../host/dsh/`，不禁 `../host/`**。实测 `src/shared/` 有 10 处 import `../host/`，其中
   6 处是对 `contract.js` 的值导入（`isReplacementSurfaceEvent` / `isSurfaceEligibleType` /
   `messageText` 之类），它们依赖的是**宿主中立的契约**，正是 shared 层该认识的唯一宿主面。
   把 `../host/contract.js` 一并禁掉会让 6 处合法边变红，那不是本批要的。
   判据落在适配层：`src/shared/` 不得认识 `src/host/dsh/`。
2. **正控制**：改动前的 `src/shared/settings.ts:24`（`import { onDispose } … ../host/dsh/lifecycle.js`）
   必须让门禁红。这条要在提交信息里留证据——**先加检查、后修代码**，顺序反了就证明不了门禁真的会响。
3. **负控制**：`src/shared/conversation.ts:8` 那类 `contract.js` 值导入必须仍然绿。

`docs/architecture.md` §2 同步补一句「shared 不得值依赖 host/」，并把它写进 `RULES.md` 4.x
的边界条（改治理文档单独提交 `docs(rules)`，判据见 `RULES.md` 第 2 章）。

---

## 6. 验收

```bash
pnpm typecheck      # 0；HostPorts 加了必填成员，任何没实现的假 ctx 会在这里红
pnpm boundary:check # 0，且新增的 shared→host 判据在场（正控制见 §5）
pnpm test           # 827/827 起，新增用例见下
pnpm build && pnpm build   # 两次 lib/ 哈希相同
```

新增用例（`test/settings-port.test.mjs`，或并入既有 `settings-form.test.mjs`）：

1. `the published value is read on every call, not captured at apply` —— fake `SettingsPort`
   第一次返回 A、第二次返回 B，两次 `effectivePluginConfig` 必须分别得到 A、B。
2. `an unreadable settings port falls back to the entry config` —— `current()` 抛错与返回
   `undefined` 两种情形都要覆盖。
3. `only the newest publication clears the shared value` —— 发布两次后 dispose 旧的，`live` 仍在。
4. 变异：把 §3.2 的 `host.settings.current()` 改成在 `publish` 时取一次快照 → 用例 1 必须红。

**运行期判据**（本批完成后）：宿主重启后改一次设置卡片，`/memory` 或 `/handoff status`
立刻读到新值——这条今天也成立，改后必须仍然成立，否则说明实时读被降级成了快照。

---

## 7. 明确不做

- 不拆设置命名空间（那是 `docs/batch-ac-settings-split-spec.md`，另一批）。
- 不改 `PluginConfig` 的 23 个键、不改默认值、不改卡片的字段与布局。
- 不为第二个宿主写适配器（只写它需要的端口），不引入新依赖。
- 不动 `test/card-render.test.mjs` 的断言形状。
