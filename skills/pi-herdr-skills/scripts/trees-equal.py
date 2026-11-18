#!/usr/bin/env python3
"""Exact directory-tree equivalence for managed skills.

Used by scripts/install.sh (conflict detection), the Astack setup browser step
before it moves a managed skill out of the way, and scripts/check-repo.sh for
mismatch diagnostics, so "content-identical" means one thing everywhere: same
relative path set, same file types, same executable bits, same regular-file
SHA-256, same symlink targets.

Usage: trees-equal.py [--report] LEFT RIGHT

Without --report: exit 0 equal, 1 not equal (or a side is not a directory),
2 usage error.

With --report: print one "<relative path>: <reason>" line per difference, then
exit 1 if any difference exists; print nothing and exit 0 when equal. A side
that is not a directory reports a single "." difference and exits 1.
"""
from pathlib import Path
import hashlib
import os
import stat
import sys


def entries(root):
    return {path.relative_to(root): path for path in root.rglob("*")}


def kind(mode):
    if stat.S_ISREG(mode):
        return "file"
    if stat.S_ISDIR(mode):
        return "directory"
    if stat.S_ISLNK(mode):
        return "symlink"
    return "other"


def path_difference(first, second):
    """Return the reasons two entries at the same relative path differ."""
    first_stat, second_stat = first.lstat(), second.lstat()
    if stat.S_IFMT(first_stat.st_mode) != stat.S_IFMT(second_stat.st_mode):
        return [f"type differs ({kind(first_stat.st_mode)} vs {kind(second_stat.st_mode)})"]

    reasons = []
    if stat.S_ISREG(first_stat.st_mode):
        first_exec = bool(first_stat.st_mode & 0o111)
        second_exec = bool(second_stat.st_mode & 0o111)
        if first_exec != second_exec:
            reasons.append(f"executable differs ({str(first_exec).lower()} vs {str(second_exec).lower()})")
        if hashlib.sha256(first.read_bytes()).digest() != hashlib.sha256(second.read_bytes()).digest():
            reasons.append("content differs")
    elif stat.S_ISLNK(first_stat.st_mode):
        first_target = os.readlink(first)
        second_target = os.readlink(second)
        if first_target != second_target:
            reasons.append(f"symlink target differs ({first_target!r} vs {second_target!r})")
    return reasons


def differences(left, right):
    """Return sorted (relative path, reason) pairs for every tree difference."""
    if not left.is_dir():
        return [(Path("."), f"left side is not a directory: {left}")]
    if not right.is_dir():
        return [(Path("."), f"right side is not a directory: {right}")]

    a, b = entries(left), entries(right)
    found = []
    for rel in sorted(a.keys() - b.keys(), key=lambda path: path.as_posix()):
        found.append((rel, "missing from right"))
    for rel in sorted(b.keys() - a.keys(), key=lambda path: path.as_posix()):
        found.append((rel, "only in right"))
    for rel in sorted(a.keys() & b.keys(), key=lambda path: path.as_posix()):
        reasons = path_difference(a[rel], b[rel])
        if reasons:
            found.append((rel, "; ".join(reasons)))
    return found


def trees_equal(left, right):
    return not differences(left, right)


def main(argv):
    report = False
    args = argv[1:]
    if args[:1] == ["--report"]:
        report = True
        args = args[1:]
    if len(args) != 2:
        print("usage: trees-equal.py [--report] LEFT RIGHT", file=sys.stderr)
        return 2

    left, right = Path(args[0]), Path(args[1])
    if report:
        found = differences(left, right)
        for rel, reason in found:
            print(f"{rel.as_posix()}: {reason}")
        return 0 if not found else 1
    return 0 if trees_equal(left, right) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
