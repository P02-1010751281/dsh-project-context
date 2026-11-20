# 调研证据包：仓库认知索引（第七类，2026-11-19）

本目录是 [`docs/research/2026-11-19-repo-cognition-index.md`](../../../docs/research/2026-11-19-repo-cognition-index.md)
的原始证据，冻结保存、不回改。

## 目录

| 路径 | 是什么 |
|---|---|
| `list.txt` | 本轮纳入的 17 个仓库（`owner/repo`） |
| `sources/<owner>__<repo>.README.md` | 从**默认分支**取的 README 原文（`fetch.sh` 记录实际 URL） |
| `sources/<owner>__<repo>.meta.json` | GitHub repo API 原始响应（星数、许可、default_branch、pushed_at） |
| `urls.tsv` | 每个仓库实际使用的 README URL（含 HTTP 码） |
| `manifest.tsv` | 34 行：时间、slug、HTTP、字节、完整 SHA-256、URL |
| `fetch.sh` | 复现脚本：按 `list.txt` 重抓 README 与 meta |
| `verify.sh` | 逐行核对 `manifest.tsv`（当前 34/34 通过） |

## 抓取方式

- 直连 `github.com` 与 `r.jina.ai` 在本机被 SSRF 判定拦截（解析到 198.18.0.0/15 的代理 fake-ip 段），
  因此 README 一律走 `raw.githubusercontent.com/<owner>/<repo>/<default_branch>/README.md`。
- 默认分支取自 repo API 的 `default_branch`，不是猜的：`srclight` 是 `develop`，
  `code2prompt` / `claude-context` 是 `master`，其余是 `main`；`urls.tsv` 是实际使用值。
- 抓取时间是 2026-11-20T08:46+08:00（本文档标注为 2026-11-19 的调研轮次，跨过了午夜）。

## 证据等级

1. 全部机制描述来自各自 README；**没有逐个安装试用**（例外见下一节）。
2. 星数是单点快照；`pushed_at` 只说明最近有推送，不说明成熟度。
3. 厂商声称的 token 节省（CCE 的 94%、srclight 的 40–60% 定向开销、codesight 的「数千 token」）
   都是自述，未复现；引用时必须写成「声称」。

## 已有的实测（不在本包，指向 AOCI 证据）

AOCI 是这一类里唯一被实测过的：二进制校验、init/scan/verify、MCP 工具面、成本预估，
原始输出在 [`../2026-11-19-aoci/`](../2026-11-19-aoci/README.md)。本包只负责「这类有多少玩家、
各自走哪条路线」。
