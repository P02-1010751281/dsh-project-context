#!/usr/bin/env python3
"""Apply one named mutant to /mnt/Data/Projects/dsh-project-context/src (edit src/ only)."""
import sys, pathlib

ROOT = pathlib.Path("/mnt/Data/Projects/dsh-project-context")

MUTANTS = {
    # A: remove the gate's "body was shown" condition only.
    "A": [(
        "src/project-autolearn/candidate.ts",
        '\t\tif (!shownNames.has(collision.name)) return "body not shown this pass";\n',
        "",
    )],
    # B: remove the write path's independent "body was shown" condition only.
    "B": [(
        "src/project-autolearn/candidate.ts",
        '\tif (replaced && autolearnProvenance(replaced) && !shownNames.has(skill.name)) return { rejected: "body not shown this pass" };\n',
        "",
    )],
    # C: remove both shown conditions.
    "C": [
        (
            "src/project-autolearn/candidate.ts",
            '\t\tif (!shownNames.has(collision.name)) return "body not shown this pass";\n',
            "",
        ),
        (
            "src/project-autolearn/candidate.ts",
            '\tif (replaced && autolearnProvenance(replaced) && !shownNames.has(skill.name)) return { rejected: "body not shown this pass" };\n',
            "",
        ),
    ],
    # D: render every learned body, ignoring what was asked for.
    "D": [(
        "src/project-autolearn/inventory.ts",
        "\tconst wanted = new Set(requested.slice(0, MAX_INSPECT_SKILLS));",
        "\tconst wanted = new Set(skills.map((entry) => entry.name));",
    )],
    # E: ignore the count cap.
    "E": [(
        "src/project-autolearn/inventory.ts",
        "\tconst wanted = new Set(requested.slice(0, MAX_INSPECT_SKILLS));",
        "\tconst wanted = new Set(requested.slice(0, 99));",
    )],
    # F: drop inspect_skill from the schema's required list.
    "F": [(
        "src/project-autolearn/schema.ts",
        '\t\trequired: ["skill", "need_sessions", "inspect_skill"],',
        '\t\trequired: ["skill", "need_sessions"],',
    )],
    # G: revert the approve-path honesty clause.
    "G": [(
        "src/project-autolearn/candidate.ts",
        'return { ok: true, message: `${existing ? "Updated" : "Activated"} project skill: ${name}${existing ? " — approved by hand; the body was not shown to the approval" : ""}` };',
        'return { ok: true, message: `${existing ? "Updated" : "Activated"} project skill: ${name}` };',
    )],
    # H: never read the body ask out of a text reply.
    "H": [(
        "src/project-autolearn/parse.ts",
        "\treturn { skill, needSessions: readNeedSessions(parsed.need_sessions), inspectSkill: readInspectSkill(parsed.inspect_skill) };",
        "\treturn { skill, needSessions: readNeedSessions(parsed.need_sessions), inspectSkill: readInspectSkill(undefined) };",
    )],
    # I: never list the names whose body could not be shown.
    "I": [(
        "src/project-autolearn/prompt.ts",
        "\treturn notShown.length\n\t\t? [\"\", `No body was shown for these requested names, so they stay off limits this pass: ${notShown.join(\", \")}.`]\n\t\t: [];",
        "\treturn [];",
    )],
    # J: the follow-up no longer tells the model which material it is answering from.
    "J": [(
        "src/project-autolearn/pass.ts",
        "\t\t\t\tif (extracts.length > 0 || bodies.text !== \"\") {",
        "\t\t\t\tif (false) {",
    )],
}

name = sys.argv[1]
for rel, old, new in MUTANTS[name]:
    p = ROOT / rel
    text = p.read_text()
    if text.count(old) != 1:
        sys.exit(f"mutant {name}: expected exactly one match in {rel}, got {text.count(old)}")
    p.write_text(text.replace(old, new))
print(f"applied mutant {name}")
