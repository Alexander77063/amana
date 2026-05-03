ALTER TABLE transactions
  ADD CONSTRAINT transactions_bump_request_id_fkey
  FOREIGN KEY (bump_request_id) REFERENCES bump_requests(id)
  ON DELETE RESTRICT;
