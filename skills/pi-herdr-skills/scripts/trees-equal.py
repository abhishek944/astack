#!/usr/bin/env python3
"""Exact directory-tree equivalence for managed skills.

Used by scripts/install.sh (conflict detection) and by the Astack setup browser
step before it moves a managed skill out of the way, so "content-identical"
means one thing everywhere: same relative path set, same file types, same
executable bits, same regular-file SHA-256, same symlink targets.

Exit status: 0 equal, 1 not equal (or a side is not a directory), 2 usage error.
"""
from pathlib import Path
import hashlib
import os
import stat
import sys


def entries(root):
    return {path.relative_to(root): path for path in root.rglob("*")}


def trees_equal(left, right):
    if not left.is_dir() or not right.is_dir():
        return False
    a, b = entries(left), entries(right)
    if a.keys() != b.keys():
        return False
    for rel, first in a.items():
        second = b[rel]
        first_stat, second_stat = first.lstat(), second.lstat()
        if stat.S_IFMT(first_stat.st_mode) != stat.S_IFMT(second_stat.st_mode):
            return False
        if stat.S_ISREG(first_stat.st_mode):
            if (first_stat.st_mode & 0o111) != (second_stat.st_mode & 0o111):
                return False
            if hashlib.sha256(first.read_bytes()).digest() != hashlib.sha256(second.read_bytes()).digest():
                return False
        elif stat.S_ISLNK(first_stat.st_mode):
            if os.readlink(first) != os.readlink(second):
                return False
    return True


def main(argv):
    if len(argv) != 3:
        print("usage: trees-equal.py LEFT RIGHT", file=sys.stderr)
        return 2
    return 0 if trees_equal(Path(argv[1]), Path(argv[2])) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
