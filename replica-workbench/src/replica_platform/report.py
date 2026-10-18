"""Deterministic Markdown report generation."""

from __future__ import annotations

import json
from pathlib import Path

from .case import load_case


def write_report(case: Path) -> Path:
    metadata = load_case(case)
    evidence = []
    for path in sorted((case / "evidence").glob("*.json")):
        evidence.append((path, json.loads(path.read_text(encoding="utf-8-sig"))))
    verification_runs = [(item.get("recorded_at", ""), item.get("data", {})) for _, item in evidence
                         if item.get("title") == "Fresh workbench verification"
                         and isinstance(item.get("data"), dict)]
    latest_run = max(verification_runs, key=lambda item: item[0], default=None)
    lines = [f"# Replica Report: {metadata['id']}", "", f"- Created: {metadata['created_at']}",
             f"- Target: `{metadata['target']['value']}`", f"- Type: `{metadata['target']['type']}`",
             f"- Version: `{metadata['target'].get('version') or 'unspecified'}`", "",
             "## Authorization", "", f"- Status: `{metadata['authorization']['status']}`",
             f"- Basis: {metadata['authorization']['basis']}",
             f"- Expires: `{metadata['authorization'].get('expires_at') or 'not granted'}`", "",
             "## Latest Verification", ""]
    if latest_run:
        run = latest_run[1]
        lines.extend([f"- Verdict: `{run.get('verdict', 'unknown')}`",
                      f"- Run ID: `{run.get('run_id', 'unknown')}`",
                      f"- Recorded: `{latest_run[0] or 'unknown'}`",
                      f"- Rebuild: `{run.get('rebuild', 'unknown')}`", ""])
    else:
        lines.extend(["No fresh verification run has been recorded.", ""])
    lines.extend(["## Evidence", ""])
    if not evidence:
        lines.append("No evidence records have been added.")
    else:
        for path, item in evidence:
            if "title" not in item or "kind" not in item:
                lines.extend([f"### Artifact: {path.name}", "", "- Kind: `artifact`",
                              "- Source: adapter output", "", "```json",
                              json.dumps(item, ensure_ascii=False, indent=2), "```", ""])
                continue
            lines.extend([f"### {item['title']}", "", f"- Kind: `{item['kind']}`",
                          f"- Source: `{item['source']}`", "", "```json",
                          json.dumps(item["data"], ensure_ascii=False, indent=2), "```", ""])
    lines.extend(["## Open limitations", "", "Record untested browsers, platforms, timing assumptions and unknown behavior here.", ""])
    output = case / "report" / "report.md"
    output.write_text("\n".join(lines), encoding="utf-8")
    return output
