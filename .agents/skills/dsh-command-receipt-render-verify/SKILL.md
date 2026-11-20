---
name: dsh-command-receipt-render-verify
description: "Design, land and verify a dsh-project-context command receipt (/memory, /handoff status, /context, /session-log) so its payload survives the dsh client's collapsed one-line card: read the server text builder and the client GenericCommandCard folding rule first, put the payload on line 1, then prove it only after a client rebuild plus tab hard-reload."
derived_from: autolearn
evidence: ["session-e24b9d97-6793-4872-bd69-eeb0e8302fc9", "session-95164f99-376c-4a3c-a9ff-1e48e53310ea"]
---

<!-- autolearn-generated: this skill may be superseded by a later autolearn pass -->

# Command receipt layout and rendering in dsh-project-context

Use when adding or changing a command receipt in one of the four plugins (`/memory`, `/memory status`, `/handoff status`, `/handoff threshold`, `/context`, `/session-log tree`). A receipt's layout is not observable from tests: the dsh client folds it, so the line plan has to be derived from source and then proven on a rebuilt client.

## 1. Read the server side (what the text actually is)

- Receipts are plain text `{kind, text}` built in the plugin, e.g. `src/project-context/index.ts` (archive + command surface), `src/project-handoff/command.ts` and the `/memory` receipt in the project-memory command path. Embedded `\n` is preserved over the wire; indentation is meaningful (`/session-log tree` prints a forest).
- A receipt may only name values that come from the same gate the decision uses (a value from a different gate becomes a dead lever).

## 2. Read the client side before choosing a layout

- dsh's `GenericCommandCard` renders the collapsed row as one `white-space: nowrap` ellipsized summary of `outcome.text`.
- The `<pre>` body exists only when the text contains a newline, and it starts collapsed.
- Consequences:
  - a single-line receipt can never be expanded and is always clipped at the card width;
  - a multi-line receipt's **first line must carry the payload** (metric / counts / verdict); paths and secondary detail go on later lines, which a collapsed card hides.
- Do not assume "the client preserves newlines" means "the user sees them"; both are true at once.

## 3. Implement

- First line: self-contained summary (numbers, states, names of settings).
- Then one fact per line; keep the `source`-style line last.
- Keep the wording of an advice line tied to the gating code (see the receipt-advice invariant) and do not add a value the gate does not produce.

## 4. Build and reload

- `pnpm build` (so `lib/client.js` changes; `lib/**` is tracked and must be committed).
- Host-side text changes take effect only after that profile's host restart; client-side rendering only after a tab hard-reload — see skill `dsh-host-build-restart-verify`.

## 5. Prove it

- A test suite can pin the text shape (newline count, first line) but cannot prove rendering — say so in the commit/report.
- Real proof: the user runs the command once on the rebuilt client; check the collapsed row shows the payload and the expanded body shows all lines.
- The receipt only exists when a pass or command actually runs, so a landed fix with no pass since the restart is **unverified**: record the pending check in `CONTEXT.md` instead of claiming the layout works.

## 6. Residuals worth remembering

- A receipt's `outcome.text` carrying a path or long id on line 1 will be truncated by the ellipsis, not wrapped.
- When the same fact appears in both the collapsed summary and the body, keep them consistent — the summary is what users read.
