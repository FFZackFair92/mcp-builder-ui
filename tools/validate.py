#!/usr/bin/env python3
"""Repository validator for mcp-builder-ui.

Checks the things that break silently: malformed manifests, skill frontmatter,
dead relative links, and regressions of the API mistakes this skill exists to
prevent.

Usage:  python tools/validate.py
Exit code 0 if everything passes, 1 otherwise.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"

failures: list[str] = []
checks_run = 0


def check(condition: bool, message: str) -> None:
    global checks_run
    checks_run += 1
    if not condition:
        failures.append(message)


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


# --------------------------------------------------------------------------
# 1. Plugin manifests
# --------------------------------------------------------------------------
def validate_manifests() -> None:
    marketplace_path = ROOT / ".claude-plugin" / "marketplace.json"
    plugin_path = ROOT / ".claude-plugin" / "plugin.json"

    for path in (marketplace_path, plugin_path):
        check(path.exists(), f"missing manifest: {rel(path)}")
    if not (marketplace_path.exists() and plugin_path.exists()):
        return

    try:
        marketplace = json.loads(marketplace_path.read_text(encoding="utf-8"))
        plugin = json.loads(plugin_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        failures.append(f"invalid JSON in a manifest: {exc}")
        return

    check("name" in marketplace, "marketplace.json: missing 'name'")
    check(
        isinstance(marketplace.get("plugins"), list) and marketplace["plugins"],
        "marketplace.json: 'plugins' must be a non-empty array",
    )

    entry = (marketplace.get("plugins") or [{}])[0]
    check(
        entry.get("name") == plugin.get("name"),
        "plugin name differs between marketplace.json and plugin.json",
    )
    # Version drift between the two manifests is the classic release bug.
    versions = {
        "marketplace.metadata": marketplace.get("metadata", {}).get("version"),
        "marketplace.plugins[0]": entry.get("version"),
        "plugin.json": plugin.get("version"),
    }
    distinct = {v for v in versions.values() if v is not None}
    check(
        len(distinct) == 1,
        f"version mismatch across manifests: {versions}",
    )

    for path, source in ((plugin_path, plugin), (marketplace_path, entry)):
        for field in ("description", "license"):
            if field == "license" and path == marketplace_path:
                continue
            check(source.get(field), f"{rel(path)}: missing '{field}'")


# --------------------------------------------------------------------------
# 2. Skill frontmatter
# --------------------------------------------------------------------------
FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def validate_skills() -> None:
    skill_files = sorted(SKILLS.glob("*/SKILL.md"))
    check(bool(skill_files), "no SKILL.md found under skills/")

    for skill_file in skill_files:
        text = skill_file.read_text(encoding="utf-8")
        match = FRONTMATTER.match(text)
        if not match:
            failures.append(f"{rel(skill_file)}: missing YAML frontmatter")
            continue

        fields: dict[str, str] = {}
        for line in match.group(1).splitlines():
            if ":" in line and not line.startswith((" ", "\t", "-")):
                key, _, value = line.partition(":")
                fields[key.strip()] = value.strip()

        name = fields.get("name", "")
        description = fields.get("description", "")

        check(bool(name), f"{rel(skill_file)}: frontmatter has no 'name'")
        check(
            name == skill_file.parent.name,
            f"{rel(skill_file)}: name '{name}' != directory '{skill_file.parent.name}'",
        )
        check(bool(description), f"{rel(skill_file)}: frontmatter has no 'description'")
        # The description is injected into the system prompt; keep it bounded.
        check(
            len(description) <= 1024,
            f"{rel(skill_file)}: description is {len(description)} chars (max 1024)",
        )


# --------------------------------------------------------------------------
# 3. Relative links in markdown
# --------------------------------------------------------------------------
LINK = re.compile(r"\[[^\]]*\]\((?!https?://|#|mailto:)([^)\s]+)\)")


def validate_links() -> None:
    for md in sorted(ROOT.rglob("*.md")):
        if any(part in {"node_modules", "dist", ".git"} for part in md.parts):
            continue
        for target in LINK.findall(md.read_text(encoding="utf-8")):
            path = (md.parent / target.split("#", 1)[0]).resolve()
            check(path.exists(), f"{rel(md)}: dead relative link -> {target}")


# --------------------------------------------------------------------------
# 4. Skill evals
# --------------------------------------------------------------------------
def validate_evals() -> None:
    for evals_path in sorted(SKILLS.glob("*/evals/evals.json")):
        try:
            data = json.loads(evals_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            failures.append(f"{rel(evals_path)}: invalid JSON: {exc}")
            continue

        skill_name = evals_path.parent.parent.name
        check(
            data.get("skill_name") == skill_name,
            f"{rel(evals_path)}: skill_name != '{skill_name}'",
        )

        evals = data.get("evals", [])
        check(bool(evals), f"{rel(evals_path)}: no evals defined")

        ids = [e.get("id") for e in evals]
        check(len(ids) == len(set(ids)), f"{rel(evals_path)}: duplicate eval ids")

        for entry in evals:
            label = f"{rel(evals_path)} eval {entry.get('id')}"
            check(bool(entry.get("prompt")), f"{label}: missing prompt")
            check(
                bool(entry.get("expectations")),
                f"{label}: no expectations — an eval that asserts nothing measures nothing",
            )
            for referenced in entry.get("files", []):
                check(
                    (evals_path.parent.parent / referenced).exists(),
                    f"{label}: missing input file {referenced}",
                )


# --------------------------------------------------------------------------
# 5. Regression guards
#
# Each entry is a wrong pattern that once shipped in this repo, or that the
# ecosystem's prose docs get wrong. They fail silently at runtime, so a grep is
# the cheapest place to catch them.
# --------------------------------------------------------------------------
FORBIDDEN: list[tuple[str, str, tuple[str, ...]]] = [
    (
        r"callServerTool\(\s*[\"']",
        "callServerTool takes an object: { name, arguments } — not positional args",
        (),
    ),
    (
        r"connect\(\s*new PostMessageTransport\(\s*\)\s*\)",
        "PostMessageTransport needs its target windows, or call connect() with no argument",
        (),
    ),
    (
        r"ui:\s*\{\s*(connect|resource|frame)Domains",
        "CSP domains must be nested under _meta.ui.csp, not directly under _meta.ui",
        (),
    ),
    (
        r"text/html\+skybridge",
        "old OpenAI MIME type; MCP Apps uses text/html;profile=mcp-app",
        ("migrate_openai_app.md",),  # legitimately quoted as the 'before' state
    ),
    (
        r"registerAppResource\(\s*server\s*,\s*\{",
        "registerAppResource is positional: (server, name, uri, config, readCallback)",
        (),
    ),
]


def validate_no_regressions() -> None:
    scanned = [p for p in SKILLS.rglob("*.md") if p.is_file()] + [
        p
        for p in (ROOT / "examples").rglob("*")
        if p.is_file()
        and p.suffix in {".ts", ".tsx", ".js", ".md", ".html"}
        and "node_modules" not in p.parts
        and "dist" not in p.parts
    ]
    compiled = [(re.compile(p), why, exempt) for p, why, exempt in FORBIDDEN]

    for path in scanned:
        text = path.read_text(encoding="utf-8")
        # Frontmatter is trigger vocabulary for the model, not code. A skill
        # that helps you migrate away from `text/html+skybridge` has to name it.
        offset = 0
        if path.suffix == ".md":
            match = FRONTMATTER.match(text)
            if match:
                offset = text[: match.end()].count("\n")
                text = text[match.end() :]

        lines = text.splitlines()
        for regex, why, exempt in compiled:
            if path.name in exempt:
                continue
            # One check per (file, pattern), so the totals stay meaningful.
            hits = [
                offset + i for i, line in enumerate(lines, start=1) if regex.search(line)
            ]
            check(not hits, f"{rel(path)}:{hits[0] if hits else 0}: {why}")


# --------------------------------------------------------------------------
def main() -> int:
    validate_manifests()
    validate_skills()
    validate_links()
    validate_evals()
    validate_no_regressions()

    if failures:
        print(f"FAILED — {len(failures)} problem(s) in {checks_run} checks:\n")
        for failure in failures:
            print(f"  • {failure}")
        return 1

    print(f"OK — {checks_run} checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
