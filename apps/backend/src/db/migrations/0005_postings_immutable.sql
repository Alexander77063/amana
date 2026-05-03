-- Postings are immutable. Corrections happen via reversing entries against the
-- same transaction, never UPDATE/DELETE. Enforce at the DB layer.

CREATE OR REPLACE FUNCTION postings_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'postings is append-only; use a reversing entry instead'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER postings_no_update
  BEFORE UPDATE ON postings
  FOR EACH ROW EXECUTE FUNCTION postings_immutable();

CREATE TRIGGER postings_no_delete
  BEFORE DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION postings_immutable();
