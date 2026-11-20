# subagent-codex 模型侦察 — 2026-11-20

任务：`subagent_codex` 工具当前钉 `model: gpt-5.6-luna`，该 id 不在本机网关目录里，每次调用在 thread-start 阶段失败。本文给出候选 id 的真实调用结果、reasoning-effort 覆盖结论，以及一个推荐 + 一个后备。

- 环境：codex-cli **0.169.0**（`/home/user/.nix-profile/bin/codex`），provider `magpie`，`model_catalog_json = /home/user/.codex/magpie-models.json`
- 当前 profile 钉法：`/home/user/.dsh/profiles/desktop/cordis.patch.yml:1155-1158` → `id: subagent-codex` / `model: gpt-5.6-luna` / `permissionMode: approve-for-me`（本次只读，未改）
- 调用形式：`timeout 150 codex exec --sandbox read-only -C /mnt/Data/Projects/dsh-project-context -m <id> "Reply with exactly: READY" </dev/null`
- 顺序串行执行，每个 id 一次一轮；全部原始日志在 `logs/`，机读结果在 `base.tsv` / `high.tsv` / `control.tsv`

## 1. 目录事实

- 目录共 **108** 条（不是 109）：`python3 -c "…len(json.load(open('magpie-models.json'))['models'])"` → `total 108`
- 目录里**不存在任何 `gpt-5.6*` id**（`'5.6' in slug` 命中 0 条）；luna 只有 4 条，且都是 `gpt-6-luna`：`auto/gpt-6-luna`、`copilot/gpt-6-luna`、`commandcode-plan/gpt-6-luna`、`opendesign/gpt-6-luna`
- 所以 `gpt-5.6-luna` 属于**目录里根本没有的 id**，不是「有但弱」，与用户「luna 属老弱模型、即使有也不用」的裁定无关：这个 id 无论如何都不可用。

## 2. 基础调用结果（`-m <id>`，默认 reasoning effort）

| id | exit | READY | 墙钟 s | reported tokens | 备注 |
| --- | --- | --- | --- | --- | --- |
| `auto/gpt-6.1-sol` | 0 | 是 | 19.3 | 34,738 | 可用；本批最慢 |
| `apikeyfan/claude-opus-5-5` | 1 | 否 | 18.2 | — | **403** `APIKEY.FAN: insufficient balance`（重连 5 次后失败） |
| `auto/claude-opus-5-5` | 0 | 是 | 6.7 | 46,810 | 可用；最快 |
| `apikeyfan/gpt-6.2-sol` | 0 | 是 | 9.6 | 26,903 | 可用；单上游 |
| `auto/gpt-6.2-astra` | 0 | 是 | 11.9 | 31,073 | 可用 |
| `apikeyfan/gpt-6.1-terra` | 0 | 是 | 10.2 | 30,645 | 可用；单上游 |
| `apikeyfan/gemini-4-argon` | 124 | 否 | 150.0 | — | **挂死**：header 之后 0 字节、无 ERROR、被 `timeout` 杀 |
| `auto/gemini-4-carbon` | 124 | 否 | 150.0 | — | **挂死**：同上（两个不同前缀的 gemini 各挂一次） |
| `apikeyfan/kimi-k3.1-pro` | 1 | 否 | 10.2 | — | **403** `APIKEY.FAN: insufficient balance` |
| `auto/kimi-k3.1-pro` | 0 | 是 | 9.2 | 26,074 | 可用（同模型换成路由组就通） |
| `auto/gpt-6.2-sol` | 0 | 是 | 6.7 | 31,073 | 可用 |

对照组（当前损坏的钉法）：`gpt-5.6-luna` → exit **124**，150.0 s，无 READY；日志里有
`warning: Model metadata for \`gpt-5.6-luna\` not found. Defaulting to fallback metadata…` 随后 `ERROR: Reconnecting... 1/5`、`2/5` 直到被 timeout 杀掉。这就是「目录外的 id 在 thread-start 类阶段挂住」的实际形态。

复测（同 id 第二轮）：`auto/gpt-6.2-astra` 7.7 s READY，`auto/claude-opus-5-5` 4.8 s READY —— 两者都是 3/3 全通。

## 3. Reasoning-effort 覆盖结果

命令加 `-c 'model_reasoning_effort="high"'`（即任务里的 `-c model_reasoning_effort='"high"'`，TOML 值同为字符串 `high`）：

| id | exit | READY | 墙钟 s | header `reasoning effort:` | tokens |
| --- | --- | --- | --- | --- | --- |
| `auto/claude-opus-5-5` | 0 | 是 | 5.3 | `high` | 46,810 |
| `apikeyfan/gpt-6.2-sol` | 0 | 是 | 4.8 | `high` | 26,903 |
| `auto/gpt-6.2-astra` | 0 | 是 | 8.6 | `high` | 28,769 |
| `apikeyfan/gpt-6.1-terra` | 0 | 是 | 5.8 | `high` | 30,645 |
| `auto/gpt-6.1-sol` | 0 | 是 | 7.2 | `high` | 30,709 |

结论：五个可用 id**全部接受**该覆盖，header 由 `none` 变为 `high`，无 4xx、无告警。但只有 2/5 的计数随之变化（astra 31,073→28,769、gpt-6.1-sol 34,738→30,709），另 3 个总数逐位相同 —— 这个指标不足以证明该三个路由真的加了推理量，只能证明请求被受理。

另一个必须记下的事实：不加覆盖时，**所有** id 的 header 都是 `reasoning effort: none`，而目录里这些模型的 `default_reasoning_level` 是 `medium`、`supported_reasoning_levels` 是 `low…max`（`none` 甚至不在 `gpt-6.2-astra` 的声明档位里）。也就是说 CLI 侧未设 `model_reasoning_effort` 时实际发的是 `none`，目录默认档位没生效。

插件侧无法透传这个旋钮：`subagent-codex` 的 `Config` 只有 `providerName` / `model` / `env` / `permissionMode` / `disposeGraceMs`（`packages/subagent/subagent-codex/src/index.ts:52-58`），没有 reasoning-effort 字段。所以这次覆盖结论对 profile 的可用形态是：**能改的只有 `model`**；想把推理档一起钉住，得靠 `env` 之外的上游改动，不在本次范围。

## 4. 判读

1. **失败分三类，性质完全不同。**
   - `apikeyfan/claude-opus-5-5` 与 `apikeyfan/kimi-k3.1-pro`：403 `insufficient balance`，是**上游账号余额**问题，不是 id 写错。
   - 两个 gemini（`apikeyfan/gemini-4-argon`、`auto/gemini-4-carbon`）：header 之后零输出挂满 150 s 被杀，**不可用且失败得最慢**。
   - `gpt-5.6-luna`：元数据缺失告警 + 重连风暴 + 挂死，是**目录外 id** 的典型形态，也是当前 profile 故障的复现。
2. **路由组比单上游稳，这是本批最强的实测判据。** 同一个模型，`apikeyfan/kimi-k3.1-pro` 403 死、`auto/kimi-k3.1-pro` 9.2 s READY；`apikeyfan/claude-opus-5-5` 403 死、`auto/claude-opus-5-5` 6.7 s READY。`apikeyfan/*` 这个前缀在本次至少两个模型上余额已空，把 subagent 钉在单上游上等于把当前的「钉错 id」故障换成「钉到欠费账号」故障。
3. **`apikeyfan/gpt-6.2-sol` / `apikeyfan/gpt-6.1-terra` 实测可用**（2/2、1/1，非缓存、日志里有真实 `READY` 与 tokens 行）。它们是合法候选，但同账号的兄弟模型已经 403，风险面与现在的故障同构，因此不作推荐位。
4. **名单强度无法由本探针判定。** 提示词是「回答 READY」，测的是可用性、延迟、旋钮受理，不是智能水平；任何「哪个更聪明」的结论都不来自这次测量。

## 5. 推荐

**推荐 `auto/claude-opus-5-5`**
- 3/3 全通（6.7 / 4.8 / 5.3 s），是本批最快的可用 id；`README` 与 catalog 一致：1,000,000 ctx，档位 `low/medium/high/xhigh/max`。
- 属于路由组：其单上游兄弟 `apikeyfan/claude-opus-5-5` 已 403 欠费，它仍然通 —— 直接证明该 id 不会随某一个上游账号挂掉。
- 接受 `model_reasoning_effort="high"`（header 变 `high`，无 4xx）。

**后备 `auto/gpt-6.2-astra`**
- 3/3 全通（11.9 / 8.6 / 7.7 s），922,000 ctx，档位 `low…max`（含 `xhigh`）。
- 与推荐项**不同厂商**，一次 Claude 侧故障或政策变动不会同时打掉两个；且是本次唯一「覆盖 high 后计数确实变了」的 id 之一（31,073→28,769），说明旋钮真的到了模型侧。

**不推荐**：`gpt-5.6-luna`（目录里不存在，实测挂死）；所有 `gemini-*`（两个 id 各挂死 150 s）；`apikeyfan/claude-opus-5-5`、`apikeyfan/kimi-k3.1-pro`（403 欠费）。
**可选而非首选**：`auto/gpt-6.1-sol`（可用但最慢 19.3 s）、`apikeyfan/gpt-6.2-sol` / `apikeyfan/gpt-6.1-terra`（可用，单上游 + 同账号已现 403）。

profile 改动只应动一行：`/home/user/.dsh/profiles/desktop/cordis.patch.yml:1157` 的 `model:`。本次未改任何文件（写盘只限本目录）。

## 6. 复现与产物

```bash
# 基础
bash .agents/evidence/2026-11-20-subagent-model-scout/run.sh   "$PWD/base.tsv"  auto/claude-opus-5-5 auto/gpt-6.2-astra
# 覆盖
bash .agents/evidence/2026-11-20-subagent-model-scout/run-effort.sh "$PWD/high.tsv" 'model_reasoning_effort="high"' auto/claude-opus-5-5 auto/gpt-6.2-astra
```

- `base.tsv`（11 行）/ `high.tsv`（5 行）/ `control.tsv`（3 行，含 luna 对照）
- `logs/{base,high}-<prefix>_<id>.log`：17 份完整 stdout+stderr
- 未记录任何凭据；`logs/` 里只有 codex 的常规 header 与模型输出。

## 7. 残留与边界

- 采样在网关已热身之后，延迟数字不能跨时段直接比；`auto/gpt-6.2-astra` 第二轮报 `tokens 97`，说明计数含缓存口径变化，token 数只能同 id 前后比，不能跨 id 比。
- 只测了一次「READY」级往返，**没有**测工具调用、长上下文、多轮；`subagent_codex` 真实工作是带工具的 agent 运行，那部分本次无证据。
- gemini 的挂死只证到 150 s 内无输出；未用更长 timeout 放宽验证，也未区分是网关排队还是上游不返回。
- 结论对 `codex-cli 0.169.0` + 当日网关目录成立；目录是 10:34 的快照，换版本或换目录需重跑。
