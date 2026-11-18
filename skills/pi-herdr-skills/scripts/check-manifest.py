#!/usr/bin/env python3
"""Verify skills-manifest.json against the managed skill files in this repository.

Every listed file must exist under skills/ with the recorded SHA-256 and
executable bit, and every file under skills/ must be listed. This checks the
repository only; scripts/check-repo.sh remains the separate installed/global
equality check.

Exit status: 0 verified, 1 mismatch, 2 usage error or malformed manifest.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

MANIFEST = "skills-manifest.json"
SKILLS = "skills"
USAGE = "usage: python3 scripts/check-manifest.py"


class ManifestError(Exception):
    pass


def is_executable(mode: int) -> bool:
    # Same rule as scripts/trees-equal.py: any execute bit counts.
    return bool(mode & 0o111)


def load_entries(root: Path) -> list:
    path = root / MANIFEST
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ManifestError(f"cannot read {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise ManifestError(f"{path} is not valid JSON: {error}") from error
    entries = manifest.get("files") if isinstance(manifest, dict) else None
    if not isinstance(entries, list):
        raise ManifestError(f"{path} must contain a files array")
    return entries


def parse_entries(root: Path, entries: list) -> tuple[dict, list[str]]:
    """Validate entry shape and paths, returning accepted entries by path."""
    parsed: dict = {}
    problems: list[str] = []
    skills_root = (root / SKILLS).resolve()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            problems.append(f"files[{index}]: entry must be an object")
            continue
        path = entry.get("path")
        digest = entry.get("sha256")
        executable = entry.get("executable")
        if not isinstance(path, str) or not path:
            problems.append(f"files[{index}]: missing path")
            continue
        if not isinstance(digest, str) or len(digest) != 64 or any(
            character not in "0123456789abcdef" for character in digest.lower()
        ):
            problems.append(f"{path}: sha256 must be a 64-character hex digest")
            continue
        if not isinstance(executable, bool):
            problems.append(f"{path}: executable must be true or false")
            continue
        try:
            (root / path).resolve().relative_to(skills_root)
        except ValueError:
            problems.append(f"{path}: path must resolve inside {SKILLS}/")
            continue
        if path in parsed:
            problems.append(f"{path}: duplicate manifest entry")
            continue
        parsed[path] = entry
    return parsed, problems


def unlisted_files(root: Path, listed: dict) -> list[str]:
    skills = root / SKILLS
    discovered = []
    for dirpath, dirnames, filenames in os.walk(skills):
        dirnames.sort()
        for name in sorted(filenames):
            discovered.append((Path(dirpath) / name).relative_to(root).as_posix())
    return [path for path in discovered if path not in listed]


def verify(root: Path) -> int:
    try:
        raw_entries = load_entries(root)
    except ManifestError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    entries, problems = parse_entries(root, raw_entries)
    for path in sorted(entries):
        entry = entries[path]
        target = root / path
        if not target.is_file():
            problems.append(f"{path}: missing file")
            continue
        actual_digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if actual_digest != entry["sha256"].lower():
            problems.append(
                f"{path}: checksum mismatch (manifest {entry['sha256']}, file {actual_digest})"
            )
        actual_executable = is_executable(target.stat().st_mode)
        if actual_executable != entry["executable"]:
            problems.append(
                f"{path}: executable is {str(actual_executable).lower()}, "
                f"manifest says {str(entry['executable']).lower()}"
            )

    for path in unlisted_files(root, entries):
        problems.append(f"{path}: file is not in the manifest")

    if problems:
        print(f"ERROR: {MANIFEST} does not match the managed skills:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    print(f"PASS: {len(entries)} manifest entries verified (checksums and executable modes)")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        if argv[1:] in (["-h"], ["--help"]):
            print(__doc__.strip())
            return 0
        print(USAGE, file=sys.stderr)
        return 2
    return verify(Path(__file__).resolve().parent.parent)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
