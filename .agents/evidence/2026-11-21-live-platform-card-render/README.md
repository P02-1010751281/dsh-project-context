# 设置卡片在 0.2.2-rc.3 平台上的渲染预检（2026-11-21）

## 为什么要测

`lib/client.js` 里的设置卡片是**按钉住的 `@deepseek-ai/dsh-client-ui-primitives@0.1.7-rc.2`
类型编译**的，但运行期由宿主自己的模块系统供给 `ui-primitives`，本机 desktop 宿主跑的是
**0.2.2-rc.3**。组件名、props 或内部约定只要在这两个版本之间改过，症状会出现在**重启之后**：
设置页空白或报错。`bfea9cd` 给卡片加了上游的 `SegmentedTabs`，正好踩在这条缝上，所以重启前
先把这张卡分别对着两个版本的平台渲染一遍。

## 怎么做

`probe.mjs` 用 esbuild 把 `client/settings-card.tsx` 打两次包，唯一差别是
`@deepseek-ai/dsh-client-ui-primitives` 解析到哪个 `lib/index.js`：

- 钉住的 devDependency（0.1.7-rc.2）；
- 运行宿主 store 里的那份（`DEFAULT_STORE`，0.2.2-rc.3）。

两边都用 `react-dom/server` 渲染成静态标记，再比较**结构指纹**：页签 id、面板 id、可见面板数、
`role="switch"` 数、`<button>` 数、`dshPcRow` 数、字段 id 集合。`bytes` 与 `digest` 不参与判定——
平台自己的页签外壳在 0.2.x 多了一个 `data-size` 属性与内缩感知的指示器位移，正文结构不变。

宿主 store 里的 `node_modules` 有自己的一份 React，会让卡片拿到两个 dispatcher（`useRef` of null），
所以探针把 `react` / `react-dom` 整族固定到本仓库的副本。

## 结果（`output.json`，exit 0）

| 项 | 值 |
|---|---|
| 结构差异键 | `[]` |
| 页签 / 面板 | 3 / 3（`memory`、`autolearn`、`handoff`） |
| 可见面板 | 1 |
| `role="switch"` | 6（含 `autolearnExpireSkills`） |
| `<button>` | 18 |
| 平台字段 id | 14（含 `sessionSettledDays`） |
| 标记字节差 | +43（仅 0.2.x 页签外壳） |

## 复跑

```bash
node .agents/evidence/2026-11-21-live-platform-card-render/probe.mjs
# 宿主升级后，把新的 ui-primitives/lib/index.js 作为第一个参数传入
node …/probe.mjs /nix/store/<新的 dsh-desktop>/…/ui-primitives/lib/index.js
# 负控制：断言比较本身会红
node …/probe.mjs --control   # exit 1
```

## 边界

探针只证明**卡片能在该平台上渲染出同样的结构**，不证明宿主已经加载了 `b36743e`——那一步要
重启后看设置页（进程启动时刻 `20:02:25` 早于提交 `20:35:49`，所以本轮宿主跑的是旧构建）。
