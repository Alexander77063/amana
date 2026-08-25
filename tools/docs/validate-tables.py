#!/usr/bin/env python3
"""Check that every GitHub-flavoured-Markdown table in the docs is actually a table.

Why this exists: a pipe table with no `|---|` delimiter row under its header does not render as a
table at all — GFM falls back to printing the pipes as literal text. It looks fine in a plain editor
and wrong everywhere it matters, so nobody catches it by reading. On 2026-08-25 a sweep found 44 of
them across docs/, including every table in UI-UX-DESIGN-BRIEF.md — the one document written to be
handed to an outside design agency.

Usage:
    python tools/docs/validate-tables.py                  # scans docs/**/*.md
    python tools/docs/validate-tables.py path/to/file.md  # or specific files

Exits non-zero if anything is malformed, so it can be wired into CI.
"""

import io
import re
import sys
from pathlib import Path

DELIM = re.compile(r'^\|[\s:\-|]+\|?\s*$')


def ncols(line: str) -> int:
    """Column count of a pipe row. `\\|` is escaped content, not a separator."""
    body = line.strip().replace('\\|', '\x00')
    if body.startswith('|'):
        body = body[1:]
    if body.endswith('|'):
        body = body[:-1]
    return len(body.split('|'))


def check_block(block, start_line, path, problems):
    if len(block) < 2:
        problems.append(f'{path}:{start_line}  lone pipe row — not a table')
        return
    if not DELIM.match(block[1]):
        problems.append(f'{path}:{start_line}  missing |---| delimiter under header '
                        f'(renders as literal pipe text)')
        return
    n = ncols(block[0])
    if ncols(block[1]) != n:
        problems.append(f'{path}:{start_line + 1}  delimiter has {ncols(block[1])} columns, '
                        f'header has {n}')
    for offset, row in enumerate(block[2:]):
        # GFM pads short rows with empty cells; only an OVERFLOWING row actually loses content.
        if ncols(row) > n:
            problems.append(f'{path}:{start_line + 2 + offset}  row has {ncols(row)} columns, '
                            f'header has {n} — the extra cell is dropped')


def check_file(path, problems):
    lines = io.open(path, encoding='utf-8').read().split('\n')
    in_fence = False
    block: list[str] = []
    start = 0
    for lineno, line in enumerate(lines, 1):
        if line.lstrip().startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if line.strip().startswith('|'):
            if not block:
                start = lineno
            block.append(line)
        elif block:
            check_block(block, start, path, problems)
            block = []
    if block:
        check_block(block, start, path, problems)


def main(argv):
    targets = [Path(a) for a in argv[1:]] or sorted(Path('docs').rglob('*.md'))
    if not targets:
        print('no markdown files found', file=sys.stderr)
        return 2
    problems: list[str] = []
    for path in targets:
        check_file(path, problems)
    for problem in problems:
        print(problem)
    print(f'{len(targets)} file(s) checked — '
          + ('all tables well-formed' if not problems else f'{len(problems)} problem(s)'))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
