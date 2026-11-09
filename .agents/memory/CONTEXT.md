# Project Context

Last updated: 2026-11-09T15:17:40.000Z

## Summary

本轮跨两天。前一半在 2026-11-07 晚收口验收：磁盘核对 HEAD d8ee04f 与远端一致、工作区干净、0 未推；加载判据现读为最后一个 src/ 提交 d8ee04f @ 16:57:23，宿主 pid 164161 启动于 20:01:05，晚于判据 ⇒ 73f6184（手动 /handoff now 按自身 turn 状态退休）与 d8ee04f（辅助调用点名最低启用档）双双已加载；验收探针 .agents/evidence/2026-11-07-restart-acceptance/acceptance.sh 报 RESULT: PASS / rc=0。重启后唯一新错误已完整归因且判定不需改代码：20:03:46 一条 [handoff] LlmError「pi-ai provider "magpie-anthropic" has no configured model "scnet/DeepSeek-V4.1-Flash-1017"」，链路是 resolveTarget（runtime.ts:128，handoff 无自己的 provider/model 键）回落到会话请求头 → 用户在本轮中途把模型从 magpie-anthropic/scnet/… 切到 magpie/auto/deepseek-v4.1-flash → 那一刻头里仍是旧配对 → gate.ts:55 的 resolveModelInfo 无保护抛错 → index.ts:120 捕获、写 errors.log、置 5 分钟失败退避。自愈判据是现读的：当前会话日志 seq 371–410 的请求头已全是 provider magpie + model auto/deepseek-v4.1-flash，HANDOFF.md 仍是 16:59 的旧文件，说明之后没有交接触发。同轮纠正了我自己用 awk 整行字符串比较筛日志的误判（堆栈续行以 `{` 开头、字典序大于 `2026…`，会被当成新条目并掩盖真错误），并确认 12:01:03 那两条 [memory] cannot get required service "llm" in inactive context 实为 20:01:03、比新宿主早 2 秒的旧实例销毁噪声，重启后没有新的 SCNet 400（最后一次仍是本地 16:18:07）。收尾落盘：CONTEXT.md 重写并推送 94d2b55（往返逐字节一致、30 条目无一超 800、份额 27.7/55.4/19.8%，远端 main 与 HEAD 一致）。仍未闭合的是行为层验证：重启后 magpie 路由日志只有 2 次 dsh 调用（20:04，tools: []，均为主会话轮次），一次辅助调用都没跑过新代码，所以「辅助调用会点名最低启用档、网关接受该档」尚未在真实网关观测到。后一半是 2026-11-09 23:07 用户回来说「继续」，并新提三个产品级问题：①旧的过时记忆会干扰；②session 索引不全；③没有废弃的清洗通道。这三条尚未做任何调查或设计，是本会话留下的主要待办；本会话 token 已越 157k 阈值，结论已落盘不依赖会话存活。

## Key points

- 加载判据（2026-11-07 现读，引用前必须重算）：最后一个 src/ 提交 d8ee04f @ 2026-11-07T16:57:23+08:00；宿主 pid 164161 启动 20:01:05 晚于判据 ⇒ 已加载；验收探针 RESULT: PASS / rc=0（load、lib 与 HEAD 一致、errors.log 无更新的 cap-loss / reasoning-effort 签名）。其后提交均为 docs，所以判据未移动。
- 20:03:46 的 [handoff] LlmError 是模型切换窗口内的陈旧 provider/model 配对，不是本批缺陷：resolveTarget 优先配置、handoff 无专用键则回落到 session.requestHeader().config，gate.ts:55 的 resolveModelInfo 无保护抛入 index.ts:120 的 catch（写 errors.log + 5 分钟退避）。已自愈，证据是 seq 371–410 的请求头已是 magpie/auto/deepseek-v4.1-flash。
- 配置侧现读：ctxdev / dsh-tui / headless / web 四个 profile 的 cordis.patch.yml 仍钉 magpie-responses + "scnet/DeepSeek-V4.1-Flash-1017"，只有 desktop 是 magpie + auto/deepseek-v4.1-flash；magpie 的 stash.json 里 scnet/DeepSeek-V4.1-Flash-1017 仍在模型目录中，只是不在 magpie-anthropic 的模型表下 ⇒ 是跨世代配对。
- 日志过滤教训（本轮实际踩到）：awk 对整行做字符串比较会把多行堆栈的续行（以 `{` 开头）判为新条目并掩盖唯一真错误；必须按行首时间戳过滤。同一轮确认 12:01:03 的两条 cannot get required service "llm" in inactive context 实际发生在 20:01:03，比宿主启动早 2 秒，属旧实例销毁期噪声。
- 落盘与推送（2026-11-07）：CONTEXT.md 内容 9472/32000，往返 byte-identical: true，30 条目无一超 800 上限，各节 27.7% / 55.4% / 19.8%，无重复残句；提交 94d2b55，push rc=0，远端 refs/heads/main = 94d2b55 = 本地 HEAD，工作区 0 变更。这些读数会过期，引用前重算。
- 推送通道：经主机密钥校验的 ssh 隧道可用（本轮走 22 端口成功）；此前 198.18.0.179:443 的断连属代理栈故障，dae / mihomo 配置始终未改动。
- 行为层验证仍未发生：重启后 magpie 路由日志只有 2 次 dsh 调用（20:04，group/auto-deepseek-v4-1-flash，status 200，tools: []），都是主会话轮次，没有辅助调用跑到新代码 ⇒ effort 修复「已加载但未被行为验证」。
- 辅助调用的判别式：errors.log 的 thinking.type=disabled cannot be translated 只可能由「请求没带 effort」产生；命名 off 不是逃生口（adapter 会重写成 undefined）。
- 拒绝措辞可分流：whole entry/ies 或 section 超预算 → budget 半边；cut off by the model output limit → output 半边；fit-capped-refused → 输出预算装不下两份文档（降 maxMemoryChars 无用）。maxMemoryChars 是读写同一把尺，顺序只能是先写小文档再降 cap。
- maxMemoryChars 现为 45000（desktop + web 同日对齐 2026-11-07 09:00，回退文件 .bak-20261107-0900-maxmemory45000）；该配置与 5efaef8 都需重启生效，20:01:05 那次重启已覆盖。
- 用户 2026-11-09 提出的三个问题（原话）：1. 旧的过时的记忆会干扰；2. session 索引不全；3. 没有废弃的清洗通道。三条都还没有任何调查、规格或代码动作，需要先各自定位到具体机制再提方案——注意第 1 条与第 3 条可能同源（记忆里陈旧条目只能靠下一次整理被动淘汰，没有显式弃用通道），第 2 条对应 .agents/memory/session-logs/INDEX.md 的覆盖与回填。
- 小窗口结论（既有）：窗口是声明值不是硬限；本插件没有窗口设置项，读宿主解析的 contextWindow；≤64K 时交接余量与宿主 compaction 的 headroomTokens 65536 都不够。
- 已知噪声：context-injection.test.mjs 偶发失败，是并发写入读仓库自身 memory 文档所致，复跑即绿，未记成已修。

## Open tasks

- 六问题批次（用户 2026-11-09 提出，规格已落在 docs/batch-z-six-problems-spec.md，未改任何 src/）：Z1 索引对账（问题 2，只增不删、幂等、走现有锁）；Z2 清洗通道（问题 3，含保留期键与「tar 到仓库外再删」）；Z3 条目标记 + 锚点门禁（问题 1/5）；Z4 任务维度（问题 4，Z5 的前置）；Z5 种子按任务切片（问题 6）。依赖：Z1 独立可做；Z2 依赖 Z3 的标记约定；Z4 是 Z5 前置。
- 待用户裁定的五个岔口（规格 §8，未定前不写代码）：①删除语义用 dry-run + --apply，还是直接删但先 tar 到仓库外；②任务维度落在 CONTEXT.md 内分块，还是 .agents/memory/tasks/<slug>.md 多文件；③条目标记用 [task:..][status:..] 前缀，还是自然语言尾注；④索引自检在宿主启动时跑，还是只在显式命令/归档失败后跑；⑤406-12 那 63 条未入索引的会话是否现在就补。
- 行为验证（用户侧，阻塞）：跑一次 /memory update——成功即闭合整条链（点名 effort → 网关接受 low → 写入落地）；若仍 400，说明该路由不接受 low，应改成更高的启用档（high / max 实测通）。这也是 cap 45000 下是否还出现 lossy 拒绝的观测点。注意本会话已重启过，之前的读数需重算。
- 另一条行为验证（用户侧）：闲置会话上执行 /handoff now，应立即可归档父会话（进 ~/.dsh/storages/workspace.json 的 global.archivedSessionIds），被交接会话不再排在续接会话之上。
- 被误留的旧会话 session-88ada514 需在客户端手动归档（本批只保证今后不再发生）；已归档的 c35a7f0f / 3a51f066 需按用户判断取消归档；另可验证 handoffRetireReplaced 关掉后的效果（关闭 → 保存 → /handoff now）。
- 设计选择待用户裁定：若把路由长期钉在失效模型上，自动交接会持续被 5 分钟退避，唯一痕迹是 errors.log、无用户可见面；是否把它变成可见告警，我不擅自改。
- 观察 context-injection.test.mjs 的偶发失败是否在无并发写入时复现，再决定是否记为已修。
- 若真要在 64K 窗口运行，需同时调小 handoffBudgetRecentTokens（如 4000）、调小宿主 compaction headroomTokens、并压小两份文档，缺一不可。

<!-- latest-session-title: 重启后确认两批已加载；用户新提「旧记忆干扰 / 会话索引不全 / 无清洗通道」三问题 -->
