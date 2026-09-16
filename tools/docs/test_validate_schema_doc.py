#!/usr/bin/env python3
"""Tests for the schema-doc drift guard.

Every extractor takes string content rather than a path, so the awkward cases — the two shapes of
`pgTable(` call, an unparseable one, a reworded count claim — are inline fixtures rather than
temp-file scaffolding.

Run:  python3 -m unittest discover -s tools/docs
"""

import unittest

from validate_schema_doc import (
    ClaimNotFound,
    SchemaParseError,
    check,
    count_claim,
    declared_tables,
    documented_tables,
    enums_in_schema,
    tables_in_schema,
)

SAME_LINE = """
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
});
"""

NEXT_LINE = """
export const adminRoleGrants = pgTable(
  'admin_role_grants',
  {
    id: uuid('id').primaryKey(),
  },
);
"""

DOC = """# Amana — database schema

Current as of 2026-09-09: **2 tables, 1 enums, 3 migrations.** Where this document
and the code disagree, the code is right.

## Tables by domain

**Identity & auth** — `users`, `households`

`users.role` is `principal | agent | retailer`, matched against `SPEND_CATEGORIES`.

### Admin & IAM — decisions the tables encode

**Staff are deliberately not rows in `users`.** Prose, not a declaration list.
"""


class TablesInSchema(unittest.TestCase):
    def test_finds_a_table_declared_on_one_line(self):
        self.assertEqual(tables_in_schema({'identity.ts': SAME_LINE}), {'users'})

    def test_finds_a_table_whose_name_is_on_the_following_line(self):
        self.assertEqual(tables_in_schema({'admin.ts': NEXT_LINE}), {'admin_role_grants'})

    def test_refuses_to_guess_when_a_pgTable_call_has_no_literal_name(self):
        source = 'export const t = pgTable(TABLE_NAME, {});'
        with self.assertRaises(SchemaParseError) as caught:
            tables_in_schema({'dynamic.ts': source})
        self.assertIn('dynamic.ts', str(caught.exception))

    def test_counts_every_call_even_when_one_file_holds_several(self):
        self.assertEqual(
            tables_in_schema({'a.ts': SAME_LINE + NEXT_LINE}),
            {'users', 'admin_role_grants'},
        )


class EnumsInSchema(unittest.TestCase):
    def test_finds_enum_names(self):
        source = "export const adminRoleEnum = pgEnum('admin_role', ['owner', 'ops']);"
        self.assertEqual(enums_in_schema({'admin.ts': source}), {'admin_role'})

    def test_finds_an_enum_whose_values_start_on_the_next_line(self):
        source = "export const kindEnum = pgEnum('approval_kind', [\n  'grant',\n]);"
        self.assertEqual(enums_in_schema({'admin.ts': source}), {'approval_kind'})


class CountClaim(unittest.TestCase):
    def test_reads_the_three_numbers_the_doc_claims(self):
        self.assertEqual(count_claim(DOC), (2, 1, 3))

    def test_refuses_to_pass_silently_when_the_claim_is_reworded_away(self):
        with self.assertRaises(ClaimNotFound):
            count_claim('# Schema\n\nNo counts stated anywhere in this document.\n')

    def test_refuses_to_guess_when_two_claims_disagree(self):
        doubled = DOC + '\nAlso: **9 tables, 9 enums, 9 migrations.**\n'
        with self.assertRaises(ClaimNotFound):
            count_claim(doubled)


class DocumentedTables(unittest.TestCase):
    def test_a_backticked_name_anywhere_in_the_doc_counts_as_documented(self):
        self.assertIn('households', documented_tables(DOC))


class DeclaredTables(unittest.TestCase):
    def test_takes_the_names_from_a_domain_declaration_list(self):
        self.assertEqual(declared_tables(DOC), {'users', 'households'})

    def test_ignores_prose_backticks_below_the_declaration_lists(self):
        declared = declared_tables(DOC)
        self.assertNotIn('users.role', declared)
        self.assertNotIn('SPEND_CATEGORIES', declared)
        self.assertNotIn('principal | agent | retailer', declared)

    def test_stops_at_the_first_subsection_so_prose_bold_is_not_a_declaration(self):
        # The `### Admin & IAM` prose opens with a bold span containing `users`; it sits below the
        # region and must not be read as a declaration list.
        self.assertEqual(declared_tables(DOC), {'users', 'households'})


class Check(unittest.TestCase):
    sources = {'identity.ts': SAME_LINE + "\nexport const households = pgTable('households', {});"}
    enum_src = {'e.ts': "export const roleEnum = pgEnum('role', ['a']);"}

    def test_no_problems_when_doc_and_code_agree(self):
        problems = check(sources={**self.sources, **self.enum_src}, doc=DOC, migration_count=3)
        self.assertEqual(problems, [])

    def test_reports_a_table_that_exists_in_code_but_is_absent_from_the_doc(self):
        sources = {**self.sources, **self.enum_src,
                   'new.ts': "export const t = pgTable('brand_new_table', {});"}
        problems = check(sources=sources, doc=DOC, migration_count=3)
        self.assertTrue(any('brand_new_table' in p and 'undocumented' in p for p in problems),
                        problems)

    def test_reports_a_table_the_doc_declares_that_no_longer_exists_in_code(self):
        doc = DOC.replace('`users`, `households`', '`users`, `households`, `dropped_table`')
        problems = check(sources={**self.sources, **self.enum_src}, doc=doc, migration_count=3)
        self.assertTrue(any('dropped_table' in p for p in problems), problems)

    def test_reports_a_stale_table_count(self):
        doc = DOC.replace('**2 tables', '**30 tables')
        problems = check(sources={**self.sources, **self.enum_src}, doc=doc, migration_count=3)
        self.assertTrue(any('30' in p and 'table' in p for p in problems), problems)

    def test_reports_a_stale_migration_count(self):
        problems = check(sources={**self.sources, **self.enum_src}, doc=DOC, migration_count=49)
        self.assertTrue(any('migration' in p for p in problems), problems)


if __name__ == '__main__':
    unittest.main()
