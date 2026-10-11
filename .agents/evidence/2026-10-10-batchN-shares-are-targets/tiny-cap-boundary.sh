#!/usr/bin/env bash
# Is the over-cap behaviour at tiny caps a regression from batch N, or pre-existing?
#
# Extracts lib/ at 2462d59^ (the pre-port tree), gives it the repo's node_modules so its ESM imports
# resolve, and compares old vs new renderMemoryDocument over every cap 0..300 for two contents.
# Prints `overNewOnly` — the count of caps the NEW renderer exceeds and the OLD one honoured.
# 0 means the boundary is pre-existing; non-zero would be a regression.
set -u
REPO=/mnt/Data/Projects/dsh-project-context
TMP=$(mktemp -d /tmp/tiny-cap-XXXXXX)
trap 'rm -rf "$TMP"' EXIT

git -C "$REPO" archive 2462d59^ lib | tar -x -C "$TMP"
ln -sfn "$REPO/node_modules" "$TMP/node_modules"

cat > "$TMP/compare.mjs" <<'EOF'
const OLD = process.argv[2];
const NEW = process.argv[3];
const oldS = await import(OLD);
const newS = await import(NEW);
const empty = { project: [], invariants: [], pitfalls: [], index: [] };
const one = { project: ["a fact"], invariants: [], pitfalls: [], index: [] };
let diffLen = 0, overBoth = 0, overNewOnly = 0, overOldOnly = 0;
for (let cap = 0; cap <= 300; cap += 1) {
  for (const input of [empty, one]) {
    const o = oldS.renderMemoryDocument(structuredClone(input), cap);
    const n = newS.renderMemoryDocument(structuredClone(input), cap);
    if (o.text.length !== n.text.length) diffLen += 1;
    const ole = o.text.length > cap, nle = n.text.length > cap;
    if (ole && nle) overBoth += 1;
    else if (nle && !ole) overNewOnly += 1;
    else if (ole && !nle) overOldOnly += 1;
  }
}
console.log({ compared: 2 * 301, diffLen, overBoth, overNewOnly, overOldOnly });
console.log(overNewOnly === 0
  ? "RESULT: PASS - the tiny-cap over-run is pre-existing, not a regression"
  : "RESULT: FAIL - the new renderer exceeds a cap the old one honoured");
process.exit(overNewOnly === 0 ? 0 : 1);
EOF

node "$TMP/compare.mjs" "$TMP/lib/project-memory/sections.js" "$REPO/lib/project-memory/sections.js"
