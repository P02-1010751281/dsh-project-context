# 调研证据包：AOCI / AOCI-CODE（2026-11-19）

本目录是 [`docs/research/2026-11-19-aoci.md`](../../../docs/research/2026-11-19-aoci.md) 的原始证据，
冻结保存、不回改。目标是让报告里每一条关于 AOCI 的机制断言都能按 URL + SHA-256 复验。

## 目录

| 路径 | 是什么 | 钉住的版本 |
|---|---|---|
| `aoci-code-README.md` | `aoci-spec/aoci-code` 仓库 README（英文主版本，含 Volumes v1 布局、FRAS、九工具、交付与治理） | commit `3b43f7d`（2026-11-19T13:30Z） |
| `aoci-cognition-volumes-v1.txt` | Volumes v1 公开规范（`spec/public/…`，状态 R72.2 candidate） | 同一 commit |
| `dsh-aoci-README.md` | `Fourteenth-Night/dsh-aoci` 插件 README（DSH 侧集成：动态 MCP 桥、工具面、压缩折叠、已知限制） | commit `cf026a7`（v0.3.6，2026-10-26） |
| `arxiv-2605.02421-abs.html` | 论文摘要页（标题、作者、日期、摘要） | v1，2026-05-04 |
| `arxiv-2605.02421.html` | 论文 HTML 全文（Table 7 工业对比、Threats to Validity 在其中） | 同上 |
| `aoci-paper-2605.02421.txt` | 上一条的本地 html2txt 副本，便于 grep；**不是独立证据** | — |
| `org-repos.json` | GitHub org 仓库清单 API 原始响应（星数、语言、推送时间） | 抓取于 2026-11-19T23:16+08:00 |
| `releases.json` | `aoci-code` 最近三个 release 的资产清单（linux/darwin/windows、SHA256SUMS、sigstore） | 同上 |
| `probe/` | **实测输出**（2026-11-19，本仓库克隆 + `linux_amd64` 二进制 0.2.0-rc2）：init/scan/status/verify/score/header、MCP `tools/list` 与 `aoci_rules`/`aoci_overview` 载荷、`git status` | 见 §实测 |
| `manifest.tsv` | 每个成功抓取文件的时间、slug、HTTP、字节、完整 SHA-256、URL | — |
| `verify.sh` | 逐行核对 `manifest.tsv` 的字节数与完整 SHA-256；当前 8/8 通过 | — |
| `failures.tsv` | 失败的抓取（SSRF 拦截、arXiv API 空响应、research 工具的撞词噪声），保留失败本身 | — |

## 抓取方式

- GitHub 内容走 `raw.githubusercontent.com/<repo>/<commit>/…`（URL 里写死 commit，不是 `HEAD`），
  因此本包可对上文钉住的 SHA 逐字节复验。
- 直连 `github.com` 与 `r.jina.ai` 在本机都被 SSRF 判定拦下（解析到 198.18.0.0/15 的透明代理
  fake-ip 段），见 `failures.tsv`；`curl` 直连 raw 域名成功，报告里的代码块均取自 raw 原文。
- arXiv 元数据取自 abs 页的 `citation_*` meta 标签；`export.arxiv.org` API 返回空体（已记录），
  未作为证据使用。

## 实测（2026-11-19，与文档不同等级的证据）

方法：下载 `aoci_0.2.0-rc2_linux_amd64.tar.gz` 并用同 release 的 `SHA256SUMS` 校验通过；把仓库
`git clone` 到 `/tmp/aoci-probe2`（不碰工作区）；依次跑 `init --locale zh-CN`、`scan`、`status`、
`verify`、`index score --json`、`index header`；再用 stdio JSON-RPC 探 MCP 的 `tools/list` 与三个读工具。
原始输出逐字保存在 `probe/`。

**边界**：只跑了确定性半边（初始化、基线、校验、查询）。条目本身由模型撰写，本次**没有**写任何
Entry，所以这批证据说明的是「治理脚手架与成本」，**不是**「FRAS 语义质量」。副作用都在 `/tmp` 克隆里：
`AGENTS.md` 被追加 aoci 区块（原内容保留并留 backup）、新增 `.gitattributes`（强制 LF）、`.aoci/` 约 524 KB。

## 证据等级（引用前必读）

1. 机制描述仍来自**作者方文档**（README、规范、论文）；§实测 只覆盖确定性半边（初始化、基线、校验、
   查询、MCP 工具面），**FRAS 语义质量没有实测**，不要按前者给后者背书。
2. 论文的 19 个工业任务对比**不是盲测**：论文 Threats to Validity 自述"同一批开发者也执行了对比"，
   缺陷判定交给独立流水线（Claude Opus 4.6）缓解。
3. 论文脚注自述 AOCI 的 token 数是**按输入文本长度估算**（Web 界面不暴露精确计数），
   而三个对照工具是实测；Table 7 的 4.29M vs 41.49M 不能当作同精度测量。
4. 仓库 2,572 stars 是 2026-11-19 的单点读数，且该仓库 2026-08-08 才创建——星数增长快，
   但不等于生产采用率。
