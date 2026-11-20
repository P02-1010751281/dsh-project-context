# Round 3 — final adversarial review of the corrected report

Date: 2026-11-20 ~19:01–19:06 +08:00. Reviewer: `audit-r3-final`. Object: `../../2026-11-20-codex-config-compat-review/RESULT.md` (9402 bytes, mtime 19:00).
Read-only: `~/.codex/config.toml` and the dsh profile were only read. Probes ran on copies in `/tmp/r3.x10C/<variant>/`; one recount ran in a non-`/tmp` dir under this directory and was deleted afterwards.
Builds checked first: store `codex.js --version` → `codex-cli 0.153.4`; `/home/user/.nix-profile/bin/codex --version` → `codex-cli 0.169.0`.
Variants: `live` = copy of the live file; `bak` = copy of `config.toml.bak-20261120-154416-dsh-async-compaction-compat`; `ctl` = live minus the two `[features]` lines; `bogus` = live + `[bogus_section_xyz] nonsense_key = 1`. `OLD` = 0.153.4, `NEW` = 0.169.0.

## B1 — the new claims in the corrected report

| claim | command | observation | verdict |
|---|---|---|---|
| "`features list` prints 127 rows" | `CODEX_HOME=<copy> $OLD features list` | live and ctl: 135 feature rows, 135 unique names (status counts: 42 stable, 52 under development, 36 removed, 3 deprecated, 2 experimental). Under a `/tmp` `CODEX_HOME` there is one extra `WARNING: … PATH aliases` line (136 lines); in a non-`/tmp` dir, 135 lines and no warning. 127 does not reproduce. | **WRONG number** — 135 |
| "none `async_compaction`" | same, `grep -c async_compaction` | 0 on live and on ctl. Nearest rows: `compaction_image_budget`, `guardian_reuse_parent_compaction`, `remote_compaction_v2`. | CONFIRMED |
| "on every variant" | `CODEX_HOME=bak $OLD features list` | rc=1, `Error: failed to load bootstrap configuration`. The original table form produces no list at all. | **OVERSTATED** — true only for variants that load |
| "`Unknown feature flag: async_compaction`" | `$OLD --enable async_compaction features list`; `$OLD features enable async_compaction` | both rc=1, `Error: Unknown feature flag: async_compaction` | CONFIRMED |
| "accepts a made-up section silently" | `CODEX_HOME=bogus $OLD features list \| grep -iE 'bogus\|unrecogn\|ignor'` | Only the `/tmp` PATH-alias warning; nothing about the bogus section. Round 1 also showed a successful handshake. | CONFIRMED |
| "68,938-byte system part (~61.7k prompt tokens) vs host ~240 kB / ~237.5k" | python over `~/.config/magpie/usage.jsonl` and `routing/2026-11-20.jsonl`, rows at 16:20:01.856 and .770 | codex row: `up_parts.system 68938`, `prompt.tokens 61680`, session `01a1f80a-…`, tries `[wandapi claude-opus-5-5 200]`. Host row: `up_parts.system 240052`, `prompt.tokens 237539`, no session, tries `[commandcode-plan deepseek-v4.1-flash 200]`. `.856 − .659 = 197 ms` matches. | CONFIRMED |

Other numbers checked while doing this:
- C5 cites `cordis.patch.yml:1155-1158`. `grep -n -A4 'id: subagent-codex$'` now gives `1168: - id: subagent-codex` / `1170: model: auto/claude-opus-5-5`. The anchor is stale; the file is rewritten by the settings card, so cite the grep instead of a line number.
- "`[features]` block at lines 29-30", 30 lines, 1268 bytes: CONFIRMED.
- "Row 2 … reports `clientInfo.name = "deepseek-harness"`": no round checked this. Both router rows carry `agent=dsh`. **Not established by the audit.**
- "0.153.4 `thread/start` on the real `CODEX_HOME`: ok": every audit round used copies. The only real-home evidence is the 16:20 `READY`.

## B2 — regression surface

| consumer | command | observation | verdict |
|---|---|---|---|
| PATH codex 0.169.0, original file vs edited file | `CODEX_HOME=<live\|bak\|ctl> timeout 10 $NEW exec --sandbox read-only --skip-git-repo-check -C /tmp -m invalid/no-such-model x`; `$NEW features list` | live **and bak**: `warning: Under-development features enabled: async_compaction`, `async_compaction … true`, no unrecognized-setting complaint. After normalizing timestamps and ids, stderr for live vs bak differs only in the `CODEX_HOME` path. ctl: no warning, `false`. | **No behaviour change on 0.169.0.** It already accepted the table form with the feature ON. The edit only matters for 0.153.4. |
| `[projects."/tmp"] trust_level = "trusted"` | `diff bak live`; `grep` over the evidence snapshots | The live file differs from the backup in **two** places: the features respelling and a new `[projects."/tmp"]` trusted stanza (lines 11-13). The stanza is already in `config.toml.current` (15:54) and in `config-diff.txt`. The report's "The change" section never mentions it. It marks a world-writable directory as a trusted project for every codex build that reads this file. | **Unreported change.** The writer is not established (probe artefact, codex, or the author). |
| magpie | python walk of `~/.config/magpie/stash.json`; `strings` on the magpie binary | The config carries magpie's `# magpie:` comment lines. `stash.json` has `codex.async = {"enabled":true,"cap":true}`, a magpie-side Codex async setting that is switched on. The binary (`magpie-0.1.4351`) contains no literal `async_compaction` / `[features`. | magpie is a **named candidate** for the writer of the original block. That it emits the table form is **not established**. |
| codex desktop app | `ls ~/.config/*odex* ~/.local/share/*odex*`; `ps … \| grep codex` | No codex desktop install and no running codex process found. `~/.codex/*.sqlite` was touched at 18:52 by some codex run (identity unknown). | not established / not present |

## B3 — backout validity

Commands: `sha256sum` on the backup, the evidence `config.toml.bak` and the live file; `diff bak live`; `cat -n bak`; handshake (`round1-factcheck/handshake-probe.mjs`, `M=auto/claude-opus-5-5`) and 0.169.0 exec with `CODEX_HOME=bak`.

- sha256 `81d8210e6bbc…821337b7` for both the backup and the evidence copy: CONFIRMED. Lines 26-27 are `[features.async_compaction]` / `enabled = true`. The backup's mtime is 2026-11-09 23:06, preserved by the copy.
- Restoring it on 0.153.4 gives `{"code":-32600,"message":"failed to load configuration: …config.toml:26:1: invalid type: map, expected a boolean"}`. On 0.169.0 it gives feature ON with stderr identical to the edited file. So the backout reintroduces exactly the plugin failure and changes nothing for the CLI.
- **"No more, no less" fails on one point.** A restore also deletes the `[projects."/tmp"]` trust stanza, which the report does not list as part of the change. Pinned-cwd plugin runs at `/tmp` and any `-C /tmp` CLI run lose trusted status. The effect of that was not probed.

Verdict: the backup is byte-valid. The report's description of what a restore does is incomplete.

## B4 — failure modes if a writer rewrites the file

Source: `$S/packages/subagent/subagent-codex/src/run.ts:87-103` (diagnostic format), `:256-271` (stderr forwarding), `:315-335` (startup catch). Observation: handshake stderr with the `bak` config.

| rewrite | 0.153.4 plugin | 0.169.0 CLI | loudness |
|---|---|---|---|
| table form again (original) | `initialize` succeeds; the app-server logs `ERROR codex_app_server: Invalid configuration; using defaults. …:26:1: invalid type: map, expected a boolean` on stderr. `thread/start` then returns `-32600`. The tool fails with `subagent-codex: Product subagent failure (product: Codex; stage: thread-start; category: unknown)`. The JSON-RPC text is kept only as `Error.cause`. Child stderr is copied byte for byte to the **host process's** stderr fd (`writeFileSync(process.stderr.fd, …)`, `:261`). | Accepted silently, feature ON. | **Loud at the tool surface** (failed call naming `stage: thread-start`), but **cause-blind**: the reason appears only in host stderr. Where the desktop host's stderr lands was not established. CLI: no signal at all. |
| edit-#1 shape (inline after `[mcp_servers.magpie]`) | Loads, thread starts. No signal. | `` `mcp_servers.magpie.features` is ignored `` printed at every startup; feature OFF. | Loud on the CLI, silent on the plugin, harmless to the plugin. |
| block deleted | No effect. | Feature silently OFF. | Silent. |

The report's residual risk 1 says "folds the cause into `category: unknown`; the JSON-RPC message survives only in child stderr". That is accurate on the category, but it omits that `stage: thread-start` is reported, and it misplaces the stderr: it is forwarded to the host's stderr. It is not retained anywhere per child.

## B5 — disagreements and residual over/understatement

1. **127 vs 135.** Round 1 wrote "127 rows" and the report copied it. Measured now: 135 (B1). Round 2 never counted.
2. **"on every variant".** Round 1 said absence held "under every variant". The original-config variant cannot list features at all (rc=1). Both round 1 and the report overstate this.
3. **"silently" for edit #1.** Round 1 (F6) and the report's own matrix say 0.169.0 *prints* `` `mcp_servers.magpie.features` is ignored ``. The Recommendation still says edit #1 "leaves the CLI's feature **silently** disabled". The report contradicts itself here.
4. **Purpose of the respelling.** Round 2 says deletion fixes 0.153.4 equally and is the minimal change. The report calls the boolean "the minimal spelling both builds accept" and says it "keeps both working". But 0.169.0 already worked with the original table form (B2), so the respelling's only benefit over deletion is keeping the opt-in on 0.169.0. Calling it "minimal" is wrong: deletion is smaller. The trade-off framing in the report body is correct; the Recommendation sentence overstates.
5. **Line numbers.** Round 2's 29:1 (reconstructed control) and the backup's 26:1 do not conflict. The difference is the 3-line `/tmp` stanza, and that confirms the stanza predates the respelling.
6. **Attribution.** Round 1 and round 2 agree that the 16:20 attribution is by time window only. The report now says so. No disagreement.

## Remaining defects in the report, by severity

1. **The `/tmp` trust stanza is an unreported part of the change and the backout** (B2, B3). Insert under "The change":
   > The live file also differs from the backup by a `[projects."/tmp"]` / `trust_level = "trusted"` stanza (lines 11-13), present since the 15:54 snapshot; its writer is not established. It is not needed for the fix, and restoring the backup removes it too.

   Replace residual risk 2 with:
   > Backout: `~/.codex/config.toml.bak-20261120-154416-dsh-async-compaction-compat` (sha256 `81d8210e…37b7`) restores the pre-change bytes. That reintroduces the 0.153.4 `-32600` failure, leaves 0.169.0 unchanged (it accepts the table form with the feature ON), and also removes the `/tmp` trust stanza.
2. **Wrong count and overstated scope in "What the two builds actually do".** Replace with:
   > **0.153.4 does not have the feature at all.** On every config it can load, `features list` prints 135 feature rows and none is `async_compaction`; with the original table form it cannot list features at all (`failed to load bootstrap configuration`).
3. **Self-contradiction and "minimal" in Recommendation.** Replace with:
   > The applied change (edit #2) should stand. It is the smallest spelling that fixes 0.153.4 *and* keeps the 0.169.0 opt-in; deleting the block is smaller and fixes 0.153.4 equally, but turns the CLI feature off. 0.169.0 itself was never broken: it accepted the original table form. Do not revert to edit #1 — 0.169.0 then ignores the key (with a startup warning) and the plugin gains nothing.
4. **Residual risk 1 misplaces the diagnostic and omits the named candidate writer.** Replace with:
   > `~/.codex/config.toml` is shared. magpie writes its own lines into it, and magpie's `stash.json` has `codex.async = {"enabled":true,"cap":true}`, which makes magpie the likely author of the original table block. No re-emission has been observed. If the table form returns, `subagent_codex` fails with `Product subagent failure (… stage: thread-start; category: unknown)`; the cause (`invalid type: map, expected a boolean`) is only in the app-server's stderr, which `run.ts:261` forwards to the dsh host's stderr. The 0.169.0 CLI gives no signal in that case.
5. **Stale anchor in C5.** Replace `cordis.patch.yml:1155-1158` with `` `grep -n -A4 'id: subagent-codex$' ~/.dsh/profiles/desktop/cordis.patch.yml` (line 1170 on 2026-11-20 19:03; the file is rewritten by the settings card) ``.
6. **Unverified detail in "Live acceptance".** Either drop `clientInfo.name = "deepseek-harness"` or qualify it:
   > Row 2 came from a codex app-server (`/v1/responses`, codex session id); the `clientInfo` name was not checked by the audit.

   Change "0.153.4 `thread/start` on the real `CODEX_HOME`: ok" to:
   > 0.153.4 `thread/start`: ok on copies of the live file; on the real home, evidenced by the 16:20 `READY` turn.

VERDICT: AMEND — the config edit itself is sound and its backout is byte-valid, but the report miscounts the 0.153.4 feature list, overstates scope in two places, contradicts itself on "silently", and omits the `/tmp` trust stanza that is part of both the change and the backout.
