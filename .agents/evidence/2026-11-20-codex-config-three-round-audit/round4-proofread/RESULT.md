# Proofreading result — keep the config; amend the report

Object: [compat report](../../2026-11-20-codex-config-compat-review/RESULT.md), SHA-256 `f67707ec85dd7579eb85e6d4bb4b753b57a29bf7feb64caef6d1e50b9b91b844`. Measurements: 2026-11-20, after 19:09 +08:00. No live config, profile, host, or model-turn experiment. The **historical** real-home handshake is supported by a session tool result, not by rerunning it here.

Key: E = [compat evidence](../../2026-11-20-codex-config-compat-review/); P = [pass 2](../../2026-11-20-codex-config-review-pass2/RESULT.md); R1/R2/R3 = [fact check](../round1-factcheck/RESULT.md), [adversarial](../round2-adversarial/RESULT.md), [final](../round3-final/RESULT.md). F = [ledger](../FACTS.md) fact ID, not independent proof. S = installed `packages/subagent/subagent-codex/src`; U = `~/.config/magpie/usage.jsonl`; G = sibling `routing/2026-11-20.jsonl`. Z numbers are event sequence numbers in `~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--/session-a43aa39f-dd7b-4918-9ecb-ae6b45ca5668/session.v4.jsonl.zstd`; read with `zstd -dc "$Z" | jq 'select(.seq==859)'` after assigning that path. M = remeasurements below. L numbers refer to the frozen object. Rows index sentences, code examples, log lines and matrix cells, not Markdown separators. WEAK = evidence supports narrower wording; UNSUPPORTED = no witness for the stated assertion or a counterexample. Fix numbers group repeated wording.

| Report line / sentence or cell | Support / test | Status |
|---|---|---|
| 3–4 date; one change, collateral, every correction | Z 431,455,830–859; date and change supported; not an exhaustive independently verified list | WEAK 1 |
| 4–5 nothing self-certified; four passes refuted statements; each marked inline | L9 itself says self-verified. R2 independently tested a hypothesis; not four independent reproductions of every correction. | UNSUPPORTED 1 |
| 9 first reviewer failed; lead finished matrix | Z 404,431 (failure notice),455 (lead's matrix result) | OK |
| 10 seven refutations | P §Overstatements numbers **eight** observations, some evidentiary qualifications, not a tally of seven refuted statements | UNSUPPORTED 1 |
| 11–13 ledger, R1 tally/F6 half, R2 registry verdict | F1–14; R1:16,35; R2:12 | OK |
| 14 six defects listed and applied throughout | R3:65–83 lists six, but L191–196 splits its sixth and omits its fourth. | WEAK 1 |
| 15 proofreading directory | This deliverable | OK |
| 19–24 original ending | E/config.toml.bak:26–27, identical hash M | OK |
| 26–31 binary resolution, parser, every plugin call before model selection | F1–3, S/run.ts:44,50–53,136; R1:11–14. Four model parameters, not every invocation in every context. The argument was already selected/sent; no model **turn** occurred. | WEAK 2 |
| 31–32 four values all failed | R1 F3, exact four values including omission | OK |
| 34–39 replacement | M zero-context diff, only last two lines | OK |
| 41–42 author's probes caused the original trust entry | E/config-diff.txt; R3:30 finds writer unknown; Z 830–845 corroborates a later recurrence, not original writer identity | WEAK 3 |
| 42–44 absent in backup, appeared after probes, reappeared; reproduced twice | Snapshots and Z 831,838,845 prove two sightings, **one documented removal/reappearance**. Z 835's intended safe rewrite left `/tmp` in the probe. | WEAK 3 |
| 44–45 world-writable; trusted for every build; removed | `stat -c %a /tmp` = 1777; Z 852. Stanza declares trust to consumers of this file; not tested for every build or other homes. | WEAK 3 |
| 47–48 current state; only two features lines differ | M and Z 852 | OK |
| 48–49 verification probes now use trusted cwd; unchanged after probe | Z 856/859 prove this for **the final probe**, not the earlier matrix/scripts; scoped to final verification | OK |
| 53–55 newer build ON; control prints nothing and lists false | E/exec-feature-probes/v3-features-table.txt, R1 F5, R3:29; negative is **no feature-warning match**, not empty process output | WEAK 4 |
| 56 old build does not have the feature | R2:12,19 verifies named registry flag absent, not all possible async behavior | WEAK 4 |
| 56–59 135 rows, no flag, explicit enable rejected, ON/OFF stderr difference, bogus silent, no warning proves nothing | M; R2:12 explicitly says **after timestamp normalization**; R1 F13. Absence of a warning is not evidence the key is honored. | WEAK 4 |
| 60–62 original form cannot list features | R3:12–15 reports exit 1/no list, loading forms exit 0 | OK |
| 64–65 config loads; flag inert | R1 F3/F4; R2:12,19: named flag unrecognized; no async-specific behavioral test | WEAK 4 |
| 65–66 chosen to retain newer opt-in | Z 655; R3:29 control OFF | OK |
| 66–68 deletion sufficient; boolean minimal under opt-in requirement | R2:11, R3:29, Z 455 v4. A requirement rules out deletion, not every shorter spelling; no minimality metric/search. | WEAK 5 |
| 72–76 protocol, parameters, copies, trusted cwd | S/wire.ts:269–295; R1/handshake-probe.mjs:3–12; Z 455 and /tmp/matrix-probe.mjs (cwd `/tmp`); not the later `/etc/nixos` run. Bare `app-server` isn't the executable. | WEAK 6 |
| 76–77 separate exec probe, 8 s, raw outputs | Z 656,659 and all four E/exec-feature-probes files. Ellipsis elides mandatory operational detail. | WEAK 6 |
| 77 handshake never prints feature warning | P:12 checked two model cases; Z 455. Say **did not in these runs**. | WEAK 4 |
| 81 v1 both handshakes, complaint, both flags | Z 455,659; R1 F3, R3:14,29; E/exec-feature-probes/v1-original-table.txt | OK |
| 82 v2 all cells | Z 455,659; R1 F6; E/exec-feature-probes/v2-inline-at-end.txt | OK |
| 83 v3 all cells | Z 455,659; R1 F4/F5; R2:12; E/exec-feature-probes/v3-features-table.txt | OK |
| 84 v4 all cells | Z 455 includes both thread results, Z 659 and E/exec-feature-probes/v4-inline-top.txt show newer feature ON; old registry build-wide | OK |
| 90 C1 | S/run.ts:44,50–53,136 and M versions | OK |
| 91 C2 every model | Same qualification as L31, R1 F3; parser failure consistent across all four tested | WEAK 2 |
| 92 C3 both accept; ON only on CLI | Z 455, R1 F4/F5, R2:12. Matrix agrees. | OK |
| 93 C4 successful live turn; temporal route attribution only | Z 594–599 vs U/G 9503 (route ID ends in 9503); no child ID in row | OK |
| 94 C5 pin, catalog, line; settings page rewrites file | M supports all except attribution of line drift to settings page; R3:20 and Z 866 repeat the attribution, not a settings write event. | WEAK 7 |
| 98 real-home old thread starts, no invalid type or bad stderr | Z 856/859: trusted cwd, `threadOk:true`, empty **filtered** stderr (`/invalid\|unrecognized/i`); not a clean-stderr assertion. | WEAK 4 |
| 99 newer thread ok; no complaint; feature ON | Z 455 and separate Z 659, R3:29 | OK |
| 100–101 edit changes nothing whatsoever on newer CLI | R3:29 covers parse/start, feature listing, warning, normalized stderr; not all CLI behavior | WEAK 4 |
| 102 READY at 16:20; flag inert | Z 594–599 proves READY. R2:19 limits inert claim | WEAK 4 |
| 104,106,109 turn-stage error and 16:11 router row | R1 F7, P:13, U 9435, Z 507; correlated 402, not parser failure | OK |
| 112 direct exec returned 402 with quoted text | Z 514, application error message, not shell exit status | OK |
| 113 sweep ran 16:11:40–16:14:32 | R1 F14 is a **router selection window**. Z 541 still running 16:15:03; G includes GLM retries to 16:15:11.563. | UNSUPPORTED 8 |
| 117 DeepSeek auto usable | Z 541 READY discriminator | OK |
| 118 commandcode DeepSeek usable | Z 541 same | OK |
| 119 Opus/Astra WandAPI 402 | Z 514, R1 F14 | OK |
| 120 FastAI/APIKEY.FAN/Sonnet 403 balance | Z 520,541; G Sonnet 16:14:19 CoreCode insufficient quota | OK |
| 121 GLM 401 after other attempts | G 16:14:32 outer status vs per-try statuses, R1 F14 | OK |
| 122 two Kimi routes no answer within 70–90 s | Z 518 sets a max of 90, 520 gives CodeArts failure and pending WorkBuddy, 530 requests cancellation. G records 401/429; no full 70–90 s window established per model. | WEAK 8 |
| 124 allowance recovered by 16:19 | Z 590/U 9501 prove request success, not account funding/allowance state | UNSUPPORTED 9 |
| 124–125 billing recovery alone explains later 200, cannot explain parser error | R2:13 says recovery **could** explain change in statuses; doesn't identify cause. Controlled parser result independent. | WEAK 9 |
| 130,131 two 200 rows incl. token accounting | U 9501,9503; M exact timestamps/status/counts | OK |
| 134 first row direct CLI | Z 590 and U 9501 | OK |
| 134–138 row 2 is app-server reporting clientInfo; contrasts with host | S/wire.ts:270–274 proves what plugin **sends**, not what U records. M confirms endpoints, sessions, sizes for two specific rows. Token counts are whole prompt, not system-only; event attribution remains an inference. | WEAK 10 |
| 140,143–145 event log ties call to second; tool, child, started | Z 594–596, including call ID and child name/ID | OK |
| 146 usage timestamp, 197 ms | M U 9503 minus Z 595 at millisecond precision | OK |
| 147 settled closing message | Z 599 notice spliced at .737; that's notice time rather than independently measured completion time | OK |
| 150–152 no common identifier found; temporal/shape basis | R1 F9 and Z 594–599 vs U 9503 (Codex session id distinct from child id). Supported as result of **stated search**, not proof that no identifier exists anywhere. | OK |
| 156–157 failure category doesn't name root cause | R3:46–50, S/run.ts diagnostic/startup catch; old-config stderr | OK |
| 157–159 stderr goes to host, not per-child; final sink unknown | R3:46–54; S/run.ts:261 writes process stderr fd; no sink established in review | OK |
| 160 CLI no signal for table form | R3:29,50; no **misconfiguration** signal, not literally silent (feature warning) | OK |
| 161–162 v2 warns every startup; old unaffected | Z 455,659, R1 F6 show observed handshake/exec paths, not every CLI command or all plugin effects | WEAK 4 |
| 166–169 shared config, magpie lines, stash, no literal in binary, codex trust demonstrated twice | E/config.toml.bak comments; R3:31 stash/binary; Z 830–852 shows one reappearance. Evidence identifies magpie-managed lines, not original flag writer. | WEAK 3 |
| 169–170 writer restoring original plausible, unproven; consequence | R3:31,50, R1 F3 | OK |
| 171–172 backup restores original bytes | M identical frozen backup, R3:36–39 | OK |
| 172–174 restore yields parser failure; changes nothing on newer CLI; no trust stanza restored | M diff, R3:29,39; no `/tmp` on either side. Narrow CLI equivalence to measured behavior. | WEAK 4 |
| 175–176 deletion also works, drops newer opt-in; reason for choice | R2 A1, R1 F5, Z 655 | OK |
| 177 bundled version; future store upgrade untested | M; R3:5 and P:28; newer **PATH** version tested, future store version not | OK |
| 178–179 surfacing code requires code change, separate review | R3:46–54; second part procedural recommendation | OK |
| 183 keep edit; both accept; CLI opt-in retained | Recommendation backed by Z 455,659 and R1 F4/F5 | OK |
| 184–185 avoid inline-at-end; feature OFF, warns every startup, gains nothing | E v2, R1 F6. Observed startup paths only; v4 inline at top is not v2. | WEAK 4 |
| 191 trust/backout now addressed | R3 defect 1 vs L41–49,171–174; present state correct | OK |
| 192 127→135, loadable configs only | R3 defect 2, M | OK |
| 193 silence/minimal addressed | R3 defect 3 vs L64–68,183–185; silence removed but remaining minimality claim unproved | WEAK 5 |
| 194 stale anchor replaced | R3 defect 5, M; reason for drift separate | OK |
| 195 CLI unchanged | R3 B2 did compare tested behaviors; this is not R3's missing residual-risk/diagnostic defect | WEAK 1 |
| 196 name/real home never checked | R3:22–23 said not previously independently checked. Z 856/859 and S/wire.ts now cover real-home and name **in code**, not name on the wire for that row. | WEAK 10 |

## Live measurements vs report

| Read-now source / quantity | Report → measured |
|---|---|
| `wc -lc ~/.codex/config.toml`; `diff -U0` backup vs live | 27/1225 → **27 lines/1225 bytes**. Sole hunk `@@ -26,2 +26,2 @@`: `[features.async_compaction]` / `enabled = true` → `[features]` / `async_compaction = true`. No `/tmp` stanza in either. R1/F12 and R3's 30/1268 describe the intermediate file, not now. |
| `sha256sum` backup, E/config.toml.bak, live | Backup prefix/suffix match; both originals `81d8210e6bbc0f6b1ffae1dd5bf508ce01484241c6eebf881e7e1450821337b7` (27 lines/1233 B). Live `6975be275498739c382590939cf2be03fc9a4c95515ecc8b18acc6e6697f3b0d` before/after copy-only verification, also Z 859. |
| `jq '.models|length' ~/.codex/magpie-models.json`; `models[].slug`; pin `grep -n -A4 'id: subagent-codex$' ~/.dsh/profiles/desktop/cordis.patch.yml` | 108 → **108**, pinned slug at zero-based index 17; no `gpt-5.6` prefix matches. Stanza line **1168**, model line **1170** → **1170**, value `auto/claude-opus-5-5`. |
| Installed package resolution from `S/run.ts`; `node "$OLD" --version`; PATH `codex --version`; copy-only `node "$OLD" features list` | **0.153.4 / 0.169.0**. **135 stdout rows**, **0** first-field `async_compaction`; PATH-alias warning on stderr does not count. |
| U `t,agent,req,status,in,out`; G `id,time,prompt.tokens` joined by U `route_id` | All report figures match to displayed precision. 16:11:31.637987580: WandAPI 402 0/0; 16:19:48.288294862: CLI 200 21022/3; 16:20:01.856935794: dsh-labeled WandAPI 200 21637/3. Last row `up_parts.system` **68,938 bytes** / G **61,680 prompt tokens**, vs host 16:20:01.770968195 **240,052 bytes** / **237,539 prompt tokens**. Values do not represent a bytes-to-tokens conversion; U `in` is another field. |
| Z 594/595/596/599 | **16:20:01.375/.659/.661; 16:20:04.737** (UTC+8); router `.856 − .659` = **197 ms** at displayed precision. |

## Required wording fixes (10 grouped edits)

1. **Review history:** remove “nothing … self-certified”, “every … marked inline” and “seven … refuted”. P lists eight observations; R3 lists six defects. List R3 defect 4 (named writer candidate and host-stderr forwarding) rather than treating the CLI equivalence finding as its own numbered defect.
2. **Model scope:** “With the backup loaded, thread/start failed before a model turn for all four model arguments tested (including omission).” No need for a universal history claim.
3. **Trust provenance:** “Absent in the backup, present in the 15:54 snapshot, reappeared once after explicit removal and another probe, then removed again.” Keep the two sections consistent; do not claim two controlled reproductions, proof of the first writer, or that every build honors it. The parser edit itself did not create the stanza.
4. **Observation scope:** say old registry rejects the named flag; no effect was observed in these probes. Say “no feature warning”, “after timestamp normalization”, “no invalid/unrecognized match”, and “on tested startups”. On the newer CLI, backup and final files gave the **same measured** feature/startup results, not necessarily identical behavior everywhere.
5. **Minimality:** delete “minimal” even conditionally; v3 meets the two requirements; neither a metric nor a shortest-spelling test was supplied.
6. **Command reproducibility:** distinguish historical `/tmp` matrix (Z 455,656) from the final `/etc/nixos` real-home probe (Z 856–859). `app-server --stdio` alone is not a PATH command; `codex exec …` is not runnable as written. Link complete commands/scripts. For this host the old launcher is `node "$OLD" app-server --stdio`, newer `codex app-server --stdio`, where `OLD` is the `bin/codex.js` of the manifest resolved from S/run.ts, not the PATH executable passed to Node. The copied [trusted-handshake.mjs](trusted-handshake.mjs) ran successfully as `timeout 30 node "$D/trusted-handshake.mjs" "$OLD" "$T"` (`D` = this directory, `T` = absolute temporary home containing the copied config; 25 s internal timeout; check JSON result, not just exit code). Its launcher takes **only JS**. R1's alternative accepts an argv vector but hardcodes `/tmp` and exits zero on timeout. For the new CLI's warning probe, the full safe-cwd equivalent is `CODEX_HOME="$T" timeout 8 codex exec --sandbox read-only --skip-git-repo-check -C /etc/nixos -m invalid/no-such-model hi </dev/null`; confirm the **warning**, not a successful turn. CLI help confirms all switches. Not rerun: the invalid model can still send traffic (R2 A4). Historical Z 656 used `-C /tmp`.
7. **Pin location:** quote the actual grep; optionally timestamp the observed line. Remove the unverified identification of a settings-page save as the cause of this drift.
8. **Sweep:** label 16:11:40–16:14:32 the selected router interval, not the sweep duration; GLM retried through at least 16:15:11. Say CodeArts returned 401 and WorkBuddy 429/no READY before cancellation, rather than claiming each was observed for 70–90 s.
9. **Billing:** “At 16:19:48 the same route returned 200 after a 402 at 16:11. Billing or routing recovery could explain the transition; neither explains the independent parser-control result.” The balance itself wasn't measured at recovery.
10. **200 attribution:** “The second row is consistent with the plugin's app-server. Plugin source sends `clientInfo.name = deepseek-harness`; the router row does not record that field. Temporal/route evidence supports, but does not identify, that child.” Keep the independently confirmed `READY` and C4 caveat; label both token figures whole-prompt totals.

PROOF: 10 fixes
