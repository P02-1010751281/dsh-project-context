# 开发与门禁

改代码前先读这一页：门禁命令、构建产物纪律、依赖边界、卡片测试怎么搭、dsh 侧哪些 API 是破坏性的。

## 开发

```bash
pnpm typecheck        # host + 客户端 tsc --noEmit
pnpm build            # host → lib/*.js，客户端 bundle → lib/client.js
pnpm test             # 先编译再跑 node:test 回归（test/）
```

`lib/` **纳入版本控制**：`main` / `exports` / `files` 都指向它，所以 clone 下来不构建也能装（商店读的
固定 Commit 里必须有运行时产物）。改 `src/` 或 `client/` 后要 `pnpm build` **并提交重建的产物**；
`pnpm build` 是确定性的——构建完 `git diff --exit-code -- lib` 必须为空。

`test/card-render.test.mjs` 是唯一**真正渲染**卡片的测试（其余客户端测试都是对源码的字符串扫描，
能证明某个字符串不在，不能证明控件进了 DOM）：它把 `client/settings-card.tsx` 连同平台的
`SettingsForm` / `SettingsValueField` / `Switch` / `Pill` 用 esbuild 打成一个包，经 `react-dom/server`
渲染，再按字段表核对——字段表里每一行各出现一次、布尔行渲染成开关、枚举行每个选项一个胶囊、整页只有平台的
一个保存控件，并且保存是**一次**带 revision fence 的原子写入、被拒后草稿保留且不会卡在「保存中」。
为此 `react` / `react-dom` / `clsx` / `zustand` / `immer` 是 **devDependencies**（浏览器 bundle 把它们
全部外部化，只有这个测试用）。其中后三个本不是本仓库的依赖：`@deepseek-ai/dsh-client-ui-primitives`
与 `@deepseek-ai/dsh-client-store` 的 `lib/index.js` 会 import 它们，但两个包的 manifest 只声明了 cordis
peer——Shell 从自己的 workspace 供，所以一直没人发现；自己打包的测试必须自己供上。同一份
`lib/index.js` 还会 import `shiki` / `katex` / `micromark` / `simple-icons` 等（markdown 与代码块那一面，
本卡片不渲染），测试对这些注入惰性 passthrough，并在 `t.diagnostic` 里列出实际被替换的模块。

host 侧对 `@deepseek-ai/*` 仅 type-only import（唯一的运行时值依赖是 `schemastery`，已声明在
`peerDependencies`）；客户端 bundle 的 esbuild 外部化列了 `react` / `react/jsx-runtime` /
`@deepseek-ai/dsh-client-store` / `@deepseek-ai/dsh-client-ui-primitives`（四者都由 web shell 的平台种子
提供），而实际 `require` 出去的只有 `react/jsx-runtime` 与 `@deepseek-ai/dsh-client-ui-primitives`——store
目前只作类型使用，留在列表里是显式的防回归声明（内联平台包会把它自带的 CSS modules 一起卷进单文件
bundle，那样加载不了）。

宿主半边按 **dsh 0.1.7-rc.2** 的 API 写，`peerDependencies` 的下限即该版本。rc.2 的这几处都是
**破坏性**变更、本包不再兼容 0.1.5–0.1.7-alpha 线：设置表单来自模块导出的 `Config`（`installSection`
已删）、`agent/session-start` 改为 `agent/created`、工具结果是独立的 `role: 'tool'` 消息（`tool-result`
内容块已删）、消息 `source.kind` 的 catch-all `plugin` 已删。

客户端改动**只有 `pnpm build`（或 `pnpm build:client`）才会进 `lib/client.js`**：`pnpm test` 只编译
host，漏跑会让服务端继续分发旧 bundle；重建后运行中的 `dsh web` 经 client HMR 自动换版（boot graph
的 `rev` 变化），刷新页面即可。改 host 侧（`src/`）要先 `pnpm build`，再重启**承载插件的那个 host**
才生效——可能是 `dsh web`，也可能是桌面端的 dsh-desktop（其 host 监听
`127.0.0.1:19387`）；只看提交或构建
时间不能判定已生效，要对进程启动时间。
