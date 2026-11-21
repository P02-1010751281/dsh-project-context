# Closure review — writer tests and version ladder

The Codex writer results, all eight `thread/start` cells, and the nine-output inventory reproduce. Four wording fixes are required; none changes the recommendation to keep the boolean for the installed builds.

`P` below means `python3 probe.py` from this directory ([probe](probe.py), [captured output](observations.txt)). Each invocation used a fresh temporary home, an independent config copy, and process/request cwd `/etc/nixos`. The probe stopped at `thread/start`, not a model call. `M=/nix/store/d9rx4ggdywqvbcsysbkjd0nrjpxjcbjm-magpie-0.1.4570/bin/.magpie-wrapped`.

| Verdict | Claim and result | Command |
|---|---|---|
| CONFIRMED | 0.164.0, 0.167.0 and 0.169.0 each rewrote the backup’s nested table as `[features]` followed by `async_compaction= true`. With the key initially absent, all three wrote `async_compaction = true`. | `P` → `features enable async_compaction` |
| CONFIRMED | 0.153.4 returned exit 1, `Unknown feature flag: async_compaction`; both nested and key-absent copies remained byte-identical. This tests the feature command, not every possible write interface. | `P` → `features enable async_compaction` |
| CONFIRMED | Live state is consistent with the lead’s reported effort-setting round trip: SHA-256 `6975be275498739c382590939cf2be03fc9a4c95515ecc8b18acc6e6697f3b0d`, block `[features]` / `async_compaction = true`, mtime `2026-11-21 08:45:22.705058704 +0800`. Hash and mtime matched before and after this review’s probes. A magpie process started at 00:02:55. This later mtime neither proves nor contradicts the earlier reported 13.5-hour interval; that interval and the intervening effort write are the lead’s observations, not independent reproductions. | `sha256sum ~/.codex/config.toml; stat -c '%y' ~/.codex/config.toml; diff -U0 ~/.codex/config.toml.bak-20261120-154416-* ~/.codex/config.toml; ps -eo lstart,comm` |
| CONFIRMED | Magpie 0.1.4570 help lists exactly `model, effort, subagent, subagent_model, compact_model, subagent_effort, memories, login, scope, statusline`; no async field is advertised. No magpie setter was run. | `magpie codex --help` |
| CONFIRMED | Four literal hits: 50418302 bare `async_compaction`; 50562821 `features.async_compaction`; 50684220 `features.async_compaction.enabled`; 51019497 `features.async_compaction.model_async_compact_threshold_percent`. | `LC_ALL=C grep -aobF async_compaction "$M"`; for each offset `o`: `dd if="$M" bs=1 skip=$((o-32)) count=128 status=none` |
| OVERSTATED | “All read paths” / accepts both shapes on read. The first hit sits between `codex.effort_set` and `0.171.0-alpha.12` in pooled bytes, not in a dotted path. None of the four byte windows identifies a caller or the direction of access. | Same offset and byte-window commands above |
| OVERSTATED | Only an uninstalled program could restore the table. The tested commands did not emit it; they do not exhaust installed programs or automatic write paths. A `[desktop]` key is not evidence of authorship. | `P`; `magpie codex --help`; offset scan above |
| CONFIRMED | 0.153.4: nested → `thread/start` error `-32600 … invalid type: map, expected a boolean`; boolean → thread ID. | `P` → `node <codex.js> app-server --stdio` |
| CONFIRMED | 0.164.0: nested → thread ID; boolean → thread ID. | `P` → `<0.164.0 ELF> app-server --stdio` |
| CONFIRMED | 0.167.0: nested → thread ID; boolean → thread ID. | `P` → `<0.167.0 ELF> app-server --stdio` |
| CONFIRMED | 0.169.0: nested → thread ID; boolean → thread ID. PATH resolves to the tested store executable. | `P` → `<0.169.0 ELF> app-server --stdio`; `readlink -f "$(command -v codex)"` |
| CONFIRMED | Nine installed desktop output directories: one 0.2.1-alpha.2, one 0.2.2-rc.1 and seven 0.2.2-rc.3. Each has both `@openai+codex@0.153.4` and its `-linux-x64` package. [Full store paths and package directories, one pair per output](stores.txt). | `for s in /nix/store/*-dsh-desktop-*; do test ! -d "$s" || printf '%s\n' "$s"/lib/dsh-desktop/repo/node_modules/.pnpm/@openai+codex@*; done` |
| OVERSTATED | A future same-line output necessarily keeps the parser. The inventory describes existing outputs only. | Store enumeration above |
| OVERSTATED | “Only … ≥ 0.164”, “only … 0.153.x” and safe “regardless of where the store goes next”. 0.164.0 is the first tested success, not a proven minimum. No intermediate or future build was tested. | `P`, all four builds |

## Required replacements (apply repeated corrections in both locations)

1. **Q1, lines 209–212, up to “was produced.”** Replace with: “The magpie binary contains four literal occurrences of `async_compaction`: the bare key and three dotted forms (`features.async_compaction`, `features.async_compaction.enabled`, and `features.async_compaction.model_async_compact_threshold_percent`). These bytes do not show whether the key is read or written or whether both shapes are accepted. The lead’s effort-setting test did not produce the table form.”
2. **Q1 writer scope and residual 1.** In the 0.153.4 table cell, replace “it cannot write the key at all” with “this command did not write the key”. Replace the Q1 conclusion and residual 1’s writer assessment with: “None of the tested actions emitted the nested table: the three newer Codex feature commands wrote a boolean, 0.153.4 rejected the flag without changing the copy, and the lead’s magpie effort change preserved the block. The original writer is unknown; an untested writer or code path, including one already installed, could restore it.”
3. **Q2 inventory, line 224.** Replace “so a same-line store upgrade would not change the parser” with “so switching among these nine installed outputs does not change the bundled Codex version”.
4. **Q2 conclusion (lines 234–236) and residual 4’s final sentence.** Replace with: “0.153.4 rejected the table. 0.164.0, 0.167.0 and 0.169.0 accepted it; the first compatible release was not established. Use the boolean, which passed on all four tested builds, and rerun the handshake when a different Codex build is bundled.”

CLOSURE: 4 fixes
