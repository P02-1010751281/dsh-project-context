# 重启后验收：`b36743e` 是否已在运行宿主上生效（2026-11-21 21:24–21:36）

只读取证。本目录是唯一写入点；`src/`、`client/`、`lib/`、`test/`、`package.json` 未改，未 `git add` / 未提交、未跑 `pnpm build`、未执行任何 dsh 斜杠命令。

## 快照（先看这个，避免把结论读成永久事实）

| 项 | 现读值 |
|---|---|
| 仓库 HEAD | `5a7064d328ba0176403be7100acb20eb221a8a08`（2026-11-21 20:54:04 +0800） |
| `b36743e..HEAD` 的代码差异 | 空（`git diff --stat b36743e..HEAD -- src client lib test package.json`），即 HEAD 的代码内容 = `b36743e` |
| desktop profile pin | `dsh-project-context: git+ssh://…/dsh-project-context.git#b36743e30bbfba0f0211958613cd657ab1dcc7e5` |
| Electron main / renderer / host pid | `256558` 21:21:39 / `257563` 21:21:41 / `257654` 21:21:42 |
| 35197 监听者 | `LISTEN 127.0.0.1:35197 users:(("MainThread",pid=257654,fd=38))` |
| 工作区（测量期间） | **不干净**：lead 在测量期间正在改 `src/project-memory/{consolidate,index,missing-literals}.ts`、新增 `lost-entry-repair.ts` 与测试，并已重建对应 `lib/`；另有 `CHANGELOG.md`、`docs/memory-rewrite-loss-gate-spec.md` 的未提交改动。本报告只依赖未被这些改动触及的 `lib/shared/config.js`、`lib/project-autolearn/skill-state-source.js`、`lib/client.js`、`lib/project-memory/{entry-states,entry-state,staleness-source,expiry-source,retirement}.js`。 |
| 测量之后（21:36 追加） | lead 把上述在飞改动提交为 `dcc45f9`，工作区恢复干净、HEAD 变为 `dcc45f9`。`git diff --name-only 5a7064d..dcc45f9` 对上面列出的判据文件为空，`lib/client.js` 仍是 `077a0713…2c2f`，`lib/project-memory/{entry-states,entry-state}.js` 未变，所以本报告全部结论不受影响。**但运行宿主加载的仍是 `b36743e`，不是 `dcc45f9`**——这 840 行新代码要等下一次宿主重启才生效。 |

## 结论 1：运行宿主执行的是 `b36743e` 的代码

判据是**宿主 isolate 里常驻的模块源码**，不是进程启动时刻（代码可热替换）。复用既有只读探针
`.agents/evidence/2026-11-11-z8d-live-module-version/probe.mjs`：`Debugger.enable` → 收集已解析脚本 →
`Debugger.getScriptSource` → sha256 对 `git show <commit>:lib/…` 的 blob。

打开 inspector 的手法（本项目既有）：`kill -USR1 257654` → `127.0.0.1:9229`。取证结束后已用
`process.getBuiltinModule("node:inspector").close()` 关闭，复查 `curl http://127.0.0.1:9229/json/list`
返回连接拒绝（`000`），没有留下监听端口。

```bash
node .agents/evidence/2026-11-11-z8d-live-module-version/probe.mjs --port 9229 --file lib/shared/config.js
node …/probe.mjs --port 9229 --file lib/project-autolearn/skill-state-source.js
node …/probe.mjs --port 9229 --file lib/client.js          # 负控制
```

原始输出：`resident-config.json`、`resident-skill-state.js.json`、`resident-client-negative.json`。

| 探针文件 | 常驻副本 sha256 | 与 `b36743e` blob | verdict |
|---|---|---|---|
| `lib/shared/config.js` | `cb1eb747…a098d` | 相等；同一 blob 的提交含 `b36743e`、`bfea9cd`、`dee5db8`、`c2181ba`、`5a7064d` | `the running host executes the code on disk` |
| `lib/project-autolearn/skill-state-source.js` | `8125360f…ef6719` | 相等（同上提交集） | `the running host executes the code on disk` |
| `lib/client.js`（负控制） | — | 无常驻副本 | `not loaded (the file is not parsed in this isolate)` |

负控制符合预期：`lib/client.js` 是浏览器半边，宿主 Node isolate 里不会解析它；它由结论 2 单独证明。

## 结论 2：宿主对外分发的 client bundle 就是 `b36743e` 的那份，含三页签

`35197` 的 index 与 `/plugins/` 路由需要 launch token，但**非 index 静态资源是公开的**（上游
`packages/host/frontend-static/src/index.ts` 的注释与实现：只有 index 过
`Connection` 的浏览器认证）。client-modules 的单包 combo URL 形状是
`/plugins/??<id>/client.js&rev=<rev>`，`rev` = 宿主自己对客户端产物 `(mtimeMs, ctimeMs, size)`
做的 framed sha1 前 12 位。用安装副本的 stat 复算 `rev = d72a52c37456` 后直接取到：

```bash
curl -s --path-as-is -o client-served.js \
  'http://127.0.0.1:35197/plugins/??dsh-project-context/client.js&rev=d72a52c37456'
# 200, 40529 bytes
```

宿主接受这个 rev（200）本身就是证据：路由只在该 URL 与它自己按当前文件算出的 rev 完全一致时才服务
（`packages/client/modules/src/index.ts` 的 `chunkRequest`/`comboUrl`）。

字节比对（`client-bundle-hashes.txt`）：

| 取法 | 字节 | sha256 |
|---|---|---|
| HTTP 分发 `client-served.js` | 40,529 | `464bef1b…13d4d8` |
| 去掉尾部 76 字节 `//# sourceMappingURL=…` | 40,453 | `077a0713…2c2f`（= 下面三份） |
| 安装副本 `~/.dsh/profiles/desktop/node_modules/dsh-project-context/lib/client.js` | 40,453 | `077a0713…2c2f` |
| 仓库 `lib/client.js` | 40,453 | `077a0713…2c2f` |
| `git show b36743e:lib/client.js` | — | `077a0713…2c2f` |
| `git show 5a7064d:lib/client.js` | — | `077a0713…2c2f` |

尾部 76 字节就是文档里那条「宿主分发的 bundle 比磁盘多一行 sourceMappingURL」的差异，按前缀比成立。

页签代码在分发字节里（`client-markers.txt`，`grep -acF`，served / repo `lib/client.js` 计数相同）：

| 标记 | served | built |
|---|---|---|
| `SegmentedTabs` | 1 | 1 |
| `dsh-pc-panel-` | 2 | 2 |
| `dsh-pc-tab-` | 2 | 2 |
| `section.{memory,autolearn,handoff}.title` | 各 3 | 各 3 |
| `tab.{memory,autolearn,handoff}` | 各 3 | 各 3 |
| `sessionSettledDays` | 5 | 5 |
| `autolearnExpireSkills` | 5 | 5 |

分发 bundle 里的原文（节选，完整见 `client-markers.txt`）：

```js
import_dsh_client_ui_primitives.SegmentedTabs, { className: "dshPcTabs", label: t("tabs.label"),
  value: tab, onChange: setTab, items: tabs }
…
const tabs = SECTIONS.map((section) => ({ value: section.value, label: t(section.tabKey),
  id: `dsh-pc-tab-${section.value}`, panelId: `dsh-pc-panel-${section.value}` }));
…
<section role="tabpanel" id={`dsh-pc-panel-${section.value}`}
  aria-labelledby={`dsh-pc-tab-${section.value}`} hidden={section.value !== tab}>
```

`SECTIONS` 的三个 `value` 是 `memory` / `autolearn` / `handoff`（`client/card-fields.ts`，`git show b36743e:…` 与工作区相同），
所以模板串在运行期产生的就是 `dsh-pc-panel-memory|autolearn|handoff` 三个面板 id —— 这也是为什么静态
`grep dsh-pc-panel-autolearn` 会得 0：id 是拼接出来的，不是字面量。

**平台渲染复跑**（复用既有预检探针，对着运行宿主 store 的 `0.2.2-rc.3` `ui-primitives` 渲染
`client/settings-card.tsx`）：

```bash
node .agents/evidence/2026-11-21-live-platform-card-render/probe.mjs
```

输出 `card-render-live-platform.json`（exit 0，`pass: true`）：`tablists 1`、`tabs = [autolearn, handoff, memory]`、
`panels` 同上、`visiblePanels 1`、`role="switch" 6`、字段 id 14（含 `sessionSettledDays`）、`differing: []`。
边界：这证明卡片能在这份平台上渲染出该结构，不证明渲染器当前窗口里已经加载了它（见第 ④ 节）。

## 结论 3：当前待确认（`/memory reconcile --accept`）条目

用运行宿主同一份只读聚合：`loadMemory(root, maxMemoryChars=52000)` →
`memoryEntryStates(root, text, config)`（`lib/project-memory/entry-states.js`：单一裁定者
`entryStateOf`，事实来自 `staleness-source` / `expiry-source`；`confirmed` 里已确认的理由会被
过滤掉）。profile 的 `maxMemoryChars: 52000` 从 `~/.dsh/profiles/desktop/cordis.patch.yml` 现读。

```bash
node .agents/evidence/2026-11-21-post-restart-acceptance/probe-memory-states.mjs
```

原始输出 `memory-states.json`：`checked: true`、`cappedDroppedChars: 0`、`total: 209`，
**非 healthy 的只有一类：`content-stale` 15 条**（没有 `task-closed` / `version-shipped` 命中；
`superseded` / `anchor-drift` / `age-unconfirmed` 不在这条聚合收集的事实里，本命令不会报告）。

注意：`/memory reconcile` 回执最多列 `MAX_RECONCILE_LINES = 10` 条，后面接 `… and N more`，所以
界面里看到 10 行不等于只有 10 条；下面是完整的 15 条。

可直接粘贴：

```
/memory reconcile --accept dc5
/memory reconcile --accept af0
/memory reconcile --accept ef8
/memory reconcile --accept bf1
/memory reconcile --accept d8b
/memory reconcile --accept a2f
/memory reconcile --accept 9f7
/memory reconcile --accept 0da
/memory reconcile --accept bde
/memory reconcile --accept b5b
/memory reconcile --accept 1a1
/memory reconcile --accept f89
/memory reconcile --accept fb0
/memory reconcile --accept fa5
/memory reconcile --accept 528
```

依据（`detail` 是被改的文件）：

| id | 状态 | 引用的文件 |
|---|---|---|
| `dc5` | content-stale | `src/shared/model-call.ts` |
| `af0` | content-stale | `src/project-handoff/perform.ts` |
| `ef8` | content-stale | `src/project-memory/retirement.ts` |
| `bf1` | content-stale | `src/project-memory/missing-literals.ts` |
| `d8b` | content-stale | `src/project-autolearn/skill-state-source.ts` |
| `a2f` | content-stale | `client/card-fields.ts`, `test/settings-form.test.mjs` |
| `9f7` | content-stale | `test/card-render.test.mjs` |
| `0da` | content-stale | `client/card-fields.ts` |
| `bde` | content-stale | `test/logic.test.mjs` |
| `b5b` | content-stale | `docs/README.md` |
| `1a1` | content-stale | `docs/README.md` |
| `f89` | content-stale | `client/locales.ts`, `src/project-context/index.ts`, `src/shared/config.ts` |
| `fb0` | content-stale | `src/project-memory/index.ts` |
| `fa5` | content-stale | `src/project-context/index.ts`, `src/project-context/session-state.ts`, `test/session-state.test.mjs` |
| `528` | content-stale | `docs/batch-aa-state-machines-spec.md`, `src/project-autolearn/{index,skill-state}.ts`, `test/skill-state.test.mjs` |

`bf1` 与 `fb0` 引用的文件正是本轮新提交 `dcc45f9` 改动的（`src/project-memory/{missing-literals,index}.ts`）。
测量时（21:32）它们还是未提交字节，21:36 已按同一批内容提交；现在 `--accept` 记下的是**已提交的当前字节**，
只要 `dcc45f9` 不再被追加改写就不会重复。其余 13 条由更早已提交的改动（`bfea9cd` / `dee5db8` 与更早本轮提交）造成。

只读校验：仓库 `lib/project-memory/{entry-states,entry-state,staleness-source,expiry-source,retirement}.js`
与安装副本逐字节相同（`memory-module-hashes.txt`），所以这份判定与运行宿主读到的是同一段代码。

## 证据文件

| 文件 | 内容 |
|---|---|
| `resident-config.json` | 常驻 `lib/shared/config.js` 源码 sha 与提交归属 |
| `resident-skill-state.js.json` | 常驻 `lib/project-autolearn/skill-state-source.js` 同上 |
| `resident-client-negative.json` | 负控制：`lib/client.js` 不在宿主 isolate 里 |
| `client-served.js` | 从 35197 取到的分发 bundle（40,529 B） |
| `client-bundle-hashes.txt` | served / installed / repo / `b36743e` / `5a7064d` 的 sha256 与 76 字节尾部 |
| `client-markers.txt` | 页签标记计数与分发 bundle 里的原文片段 |
| `card-render-live-platform.json` | 对 0.2.2-rc.3 平台渲染卡片的复跑输出（`pass: true`） |
| `memory-states.json` | 各状态条目、`total 209`、`acceptList` |
| `probe-memory-states.mjs` | 上面的只读探针（读 `lib/project-memory/entry-states.js`） |
| `memory-module-hashes.txt` | 记忆判定模块 repo 副本 vs 安装副本 sha256 |
| `git-snapshot.txt` | HEAD、`git status`、进程启动时刻、35197 监听者 |
| `inspector-probe.txt` / `inspector-close.txt` | inspector 打开与关闭的过程记录 |

## ④ 没有证明的部分（如实列出）

1. **渲染器进程“已执行”这份 bundle 没有被直接观察到。** Electron 没有开 remote debugging，
   renderer 没有 CDP 入口；`~/.config/@deepseek-ai/dsh-desktop/` 整个 profile（含 `Code Cache/js`、
   `Cache/Cache_Data`）里搜不到 `dsh-pc-panel-` 这个只存在于新 bundle 里的字面量，21:21 之后写下的
   缓存文件只有一个 10 KB 的小文件。所以「宿主分发的字节 = `b36743e`」已证明，「当前窗口里跑的就是
   这份字节」只有间接证据，没有直接观察。要闭合它：用户对设置页做一次硬刷新并目视确认三个页签 /
   两个新选项；或给 Electron 启动加 `--remote-debugging-port` 后由我读 renderer 的
   `Debugger.getScriptSource`（需要用户决定，我没有改启动参数）。
2. **设置卡的视觉外观**没有截图：探针证明的是结构指纹（页签/面板/开关/字段 id），不证明在
   0.2.2-rc.3 上的间距、截断与暗色主题观感。目视仍归用户。
3. **`superseded` / `anchor-drift` / `age-unconfirmed`** 没有出现在第 ③ 节，是因为
   `memoryEntryStates` 不收集这三类事实（它们由退役引擎在读入时处置），不是「已检查且为零」。
4. **`--accept` 列表的时间点** = 2026-11-21T13:32Z（`memory-states.json.measuredAt`）。lead 在飞
   的未提交改动会让 `bf1` / `fb0` 在下次正文变化后重新变成 stale；测量之后若 MEMORY.md 被整理
   pass 改写，id 集会整体换标（id 由正文 sha256 派生）。
