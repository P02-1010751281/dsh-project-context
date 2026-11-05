#!/usr/bin/env python3
"""Batch U live acceptance: does the running host render the three-state carry line?

Batch U (commit 27c8c27, 2026-10-26 17:27:11) added a carry line that states whether
the handoff tail was carried verbatim, clipped at a render cap, or absent. The only
production surface is the seed the host writes into a fresh session, so this probe
reads the archived seeds and checks two things independently:

1. the carry line equals one of the three strings from the BUILT artifact
   (`lib/project-handoff/language.js`), not from a hand-copied constant;
2. the claim matches the seed body: `trimmed` must contain `[...truncated...]`
   (what `clip()` appends when it cuts), `carried` must not.

Exit codes (each reason names itself; 0 is the only pass):
  10  no built carry string could be extracted from lib/
  11  no post-batch-U seed was found (nothing to accept)
  12  a seed's carry line matches none of the three built strings
  13  a `trimmed` seed carries no [...truncated...] witness
  14  a `carried` seed carries a [...truncated...] witness
  15  no seed produced under the running host (its start is passed via --host-start)
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.expanduser(
    "~/.dsh/sessions/--mnt-Data-Projects-dsh-project-context--"
)
BATCH_U_AT = 1793006831  # 2026-10-26 17:27:11 +0800, commit 27c8c27


def built_strings(lib_path):
    """Pull the three zh carry strings out of the built language.js."""
    text = open(lib_path, encoding="utf-8").read()
    out = {}
    for key in ("continuationCarried", "continuationTrimmed", "continuationNothing"):
        found = re.findall(key + r':\s*"((?:[^"\\]|\\.)*)"', text)
        if not found:
            return None
        # language.js carries an English and a Chinese block; the seeds here are Chinese.
        zh = [v for v in found if re.search(r"[\u4e00-\u9fff]", v)]
        out[key] = json.loads('"' + (zh[0] if zh else found[0]) + '"')
    return out


def seed_text(event):
    data = event.get("data") or {}
    for item in data.get("inserted") or []:
        if item.get("role") != "user":
            continue
        for block in item.get("content") or []:
            if block.get("text"):
                return block["text"]
    return None


def scan(root, limit_lines=400):
    rows = []
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name, "session.v4.jsonl.zstd")
        if not os.path.isfile(path):
            continue
        created = None
        text = None
        proc = subprocess.Popen(
            ["zstd", "-dc", path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        try:
            for i, raw in enumerate(proc.stdout):
                if i > limit_lines:
                    break
                try:
                    ev = json.loads(raw)
                except Exception:
                    continue
                if ev.get("type") == "session":
                    created = ev.get("createdAt")
                if ev.get("type") in ("agent/inbox/spliced", "user/message"):
                    t = seed_text(ev)
                    if t and "交接。请在本会话中接着下面的内容继续。" in t:
                        text = t
                        break
        finally:
            proc.stdout.close()
            proc.wait(timeout=20)
        if text is None:
            continue
        lines = text.splitlines()
        carry = lines[1] if len(lines) > 1 else ""
        rows.append((created, name, carry, text))
    rows.sort(key=lambda r: (r[0] is None, r[0] or 0))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lib", default="lib/project-handoff/language.js")
    ap.add_argument("--root", default=ROOT, help="session store to scan")
    ap.add_argument("--host-start", type=int, default=None,
                    help="epoch seconds when the running host started")
    args = ap.parse_args()

    strings = built_strings(args.lib)
    if not strings:
        print("FAIL: could not extract the carry strings from", args.lib)
        return 10
    by_text = {v: k.split("continuation")[1].lower() for k, v in strings.items()}
    print("built strings from", args.lib)
    for k, v in strings.items():
        print(f"  {k}: {v}")

    rows = scan(args.root)
    print(f"\nseeds found: {len(rows)}")

    # The three-state line is new in batch U: an older seed has no second line.
    pre = [r for r in rows if r[0] is not None and r[0] / 1000 < BATCH_U_AT and r[2] not in by_text]
    post = [r for r in rows if r[0] is not None and r[0] / 1000 >= BATCH_U_AT]
    print(f"pre-batch-U seeds with no carry line (negative control): {len(pre)}")
    print(f"post-batch-U seeds: {len(post)}")
    if not post:
        print("FAIL: no post-batch-U seed found")
        return 11

    mismatched = [r for r in post if r[2] not in by_text]
    print(f"carry line not matching a built string: {len(mismatched)}")
    for r in mismatched:
        print("  MISMATCH", r[1], repr(r[2][:100]))

    print()
    print(f"{'created (local)':>20}  {'variant':>8}  {'trunc':>5}  session")
    bad = []
    variants = {}
    for created, name, carry, text in post:
        variant = by_text.get(carry, "UNKNOWN")
        variants[variant] = variants.get(variant, 0) + 1
        trunc = text.count("[...truncated...]")
        stamp = time.strftime("%F %T", time.localtime(created / 1000))
        print(f"{stamp:>20}  {variant:>8}  {trunc:>5}  {name}")
        if variant == "trimmed" and trunc == 0:
            bad.append((13, name))
        if variant == "carried" and trunc > 0:
            bad.append((14, name))

    if args.host_start is not None:
        live = [r for r in post if r[0] / 1000 >= args.host_start]
        print(f"\nseeds produced under the running host: {len(live)}")
        for created, name, carry, text in live:
            stamp = time.strftime("%F %T", time.localtime(created / 1000))
            print(f"  {stamp}  {name}  {by_text.get(carry,'UNKNOWN')}")
        if not live:
            print("FAIL: no seed under the running host")
            return 15

    print("\nvariant counts (post-batch-U):", variants)
    if mismatched:
        print("FAIL: carry line does not match the built strings")
        return 12
    if bad:
        for code, name in bad:
            print(f"FAIL(code {code}): {name} claim contradicts its body")
        return bad[0][0]
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
