#!/usr/bin/env python3
"""Check that `docs/product/database-schema.md` still describes the schema the code actually has.

Why this exists: `docs/product/README.md` records **four** instances of the same defect — a
subsystem ships and the documents that describe it do not move. The schema document is the worst
affected, and the most mechanisable. It was written to supersede `BACKEND-SCHEMA.md` for predating
five schema files, and then came to predate ten tables itself in fifteen days. The README names
this check in its own words: diff the doc's table count and names against
`apps/backend/src/db/schema/*.ts` in CI, "which would have caught this one the day A1 merged".

**What this closes, and what it does not.** This guard catches the table-shaped hole: a table that
exists in code and is named nowhere in the doc, a table the doc still lists that has been dropped,
and a stale count. It does **not** catch the prose-shaped hole — the 2026-09-14 instance was a
sentence ("There is no admin client application … `[NO UI]`") that merged without a conflict into
the branch building that very client. No table was involved. A reader still has to grep the merged
tree for the claims an incoming branch falsifies.

Three checks:

1. **Counts** — the doc's `**N tables, N enums, N migrations.**` claim against what is measured.
   If that sentence cannot be found, or is found twice, this fails rather than quietly stopping:
   a guard that switches itself off when someone rewords a line is the failure it exists to prevent.
2. **Undocumented** — every `pgTable` in the schema must appear as a backticked name somewhere in
   the doc. This is the check that catches the recorded defect.
3. **Phantom** — every table named in a "Tables by domain" declaration list must exist in code, so
   a dropped table cannot linger in the one document people trust.

If a `pgTable(`/`pgEnum(` call appears whose name is not a literal string, this **fails loudly**
rather than skipping it. Silently under-counting would make the guard worse than no guard.

The filename uses underscores, unlike its sibling `validate-tables.py`, for one reason: the tests
import it.

Usage:
    python3 tools/docs/validate_schema_doc.py     # runs from anywhere; paths resolve to the repo
    python3 -m unittest discover -s tools/docs    # its tests

Exits non-zero if the doc and the code disagree, so it can be wired into CI.
"""

import io
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_ROOT / 'apps' / 'backend' / 'src' / 'db' / 'schema'
MIGRATIONS_DIR = REPO_ROOT / 'apps' / 'backend' / 'src' / 'db' / 'migrations'
DOC_PATH = REPO_ROOT / 'docs' / 'product' / 'database-schema.md'

# A Postgres identifier as Drizzle spells it in this repo: lower snake case.
IDENT = r'[a-z][a-z0-9_]*'
BACKTICKED = re.compile(r'`(' + IDENT + r')`')
CLAIM = re.compile(r'\*\*(\d+) tables?, (\d+) enums?, (\d+) migrations?\.?\*\*')
NAME_AFTER_OPEN_PAREN = re.compile(r'\s*[\'"](' + IDENT + r')[\'"]')


class SchemaParseError(Exception):
    """A pgTable/pgEnum call whose name this script cannot read. Never skipped silently."""


class ClaimNotFound(Exception):
    """The doc's count sentence is missing, reworded, or duplicated."""


def _names_from_calls(sources: dict[str, str], fn: str) -> set[str]:
    """Every literal name passed to `fn(` across `sources`.

    Handles both shapes this repo uses — `pgTable('users', {` and the prettier-wrapped
    `pgTable(\\n  'admin_role_grants',` — by matching the name after the paren rather than
    requiring it on the same line.
    """
    found: set[str] = set()
    opener = re.compile(re.escape(fn) + r'\(')
    for filename, source in sources.items():
        for call in opener.finditer(source):
            name = NAME_AFTER_OPEN_PAREN.match(source, call.end())
            if not name:
                line = source.count('\n', 0, call.start()) + 1
                raise SchemaParseError(
                    f'{filename}:{line}  {fn}( call has no literal name - this script cannot '
                    f'verify it, and will not silently skip it'
                )
            found.add(name.group(1))
    return found


def tables_in_schema(sources: dict[str, str]) -> set[str]:
    return _names_from_calls(sources, 'pgTable')


def enums_in_schema(sources: dict[str, str]) -> set[str]:
    return _names_from_calls(sources, 'pgEnum')


def count_claim(doc: str) -> tuple[int, int, int]:
    """The (tables, enums, migrations) the document claims. Raises unless found exactly once."""
    claims = CLAIM.findall(doc)
    if len(claims) != 1:
        raise ClaimNotFound(
            f'expected exactly one "**N tables, N enums, N migrations.**" claim, found '
            f'{len(claims)} - reword it back, or this guard stops checking the counts'
        )
    tables, enums, migrations = claims[0]
    return int(tables), int(enums), int(migrations)


def documented_tables(doc: str) -> set[str]:
    """Every backticked lower-snake-case token in the document, anywhere."""
    return set(BACKTICKED.findall(doc))


def declared_tables(doc: str) -> set[str]:
    """The tables the "Tables by domain" section lists as belonging to a domain.

    A declaration is a line opening with a bold domain label; names are read only from the text
    *after* that label closes, so `**Staff are deliberately not rows in `users`.**` — prose that
    happens to start bold — contributes nothing. The section ends at its first `###` subsection,
    below which everything is commentary.
    """
    lines = doc.split('\n')
    try:
        start = next(i for i, line in enumerate(lines) if line.startswith('## Tables by domain'))
    except StopIteration:
        return set()
    names: set[str] = set()
    collecting = False
    for line in lines[start + 1:]:
        if line.startswith('###') or line.startswith('## '):
            break
        if line.startswith('**'):
            parts = line.split('**', 2)
            collecting = len(parts) == 3
            if collecting:
                names.update(BACKTICKED.findall(parts[2]))
            continue
        if not line.strip():
            collecting = False
            continue
        if collecting:
            names.update(BACKTICKED.findall(line))
    return names


def check(sources: dict[str, str], doc: str, migration_count: int) -> list[str]:
    """Every way the document and the code disagree, as human-readable lines."""
    problems: list[str] = []
    tables = tables_in_schema(sources)
    enums = enums_in_schema(sources)

    try:
        claimed_tables, claimed_enums, claimed_migrations = count_claim(doc)
    except ClaimNotFound as missing:
        problems.append(f'count claim: {missing}')
    else:
        for label, claimed, actual in (
            ('tables', claimed_tables, len(tables)),
            ('enums', claimed_enums, len(enums)),
            ('migrations', claimed_migrations, migration_count),
        ):
            if claimed != actual:
                problems.append(
                    f'count: the doc claims {claimed} {label}; the code has {actual}'
                )

    documented = documented_tables(doc)
    for table in sorted(tables - documented):
        problems.append(
            f'undocumented: `{table}` exists in the schema and is named nowhere in the doc'
        )
    for table in sorted(declared_tables(doc) - tables):
        problems.append(
            f'phantom: the doc lists `{table}` under a domain, but no pgTable declares it'
        )
    return problems


def main(argv: list[str]) -> int:
    sources = {
        str(path.relative_to(REPO_ROOT)): io.open(path, encoding='utf-8').read()
        for path in sorted(SCHEMA_DIR.glob('*.ts'))
        if path.name != 'index.ts'
    }
    if not sources:
        print(f'no schema files under {SCHEMA_DIR}', file=sys.stderr)
        return 2
    doc = io.open(DOC_PATH, encoding='utf-8').read()
    # Non-recursive on purpose: drizzle-kit keeps a `meta/` folder alongside the migrations.
    migration_count = len(list(MIGRATIONS_DIR.glob('*.sql')))

    try:
        problems = check(sources=sources, doc=doc, migration_count=migration_count)
    except SchemaParseError as unparseable:
        print(unparseable)
        return 1

    for problem in problems:
        print(problem)
    tables = tables_in_schema(sources)
    print(
        f'{len(sources)} schema file(s), {len(tables)} tables, '
        f'{len(enums_in_schema(sources))} enums, {migration_count} migrations - '
        + (
            'docs/product/database-schema.md agrees'
            if not problems
            else f'{len(problems)} disagreement(s) with docs/product/database-schema.md'
        )
    )
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
