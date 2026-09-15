-- The LIMIT actually sent to the engine, which is not always the one in generated_sql.
--
-- FR-ADM-03 caps every result set, and hitting that cap is only detectable by asking
-- the engine for one row more than we intend to return. `generated_sql` is rendered at
-- the limit the READER got, because FR-CON-02's "how is this calculated?" panel has to
-- describe the result on screen. That makes generated_sql an honest explanation and an
-- incomplete execution record. This column closes the gap, rather than paying for a
-- second SQL-rendering round trip on every query to recover one character.
ALTER TABLE query_log ADD COLUMN IF NOT EXISTS engine_limit integer;

COMMENT ON COLUMN query_log.engine_limit IS
  'LIMIT sent to the engine; exceeds generated_sql''s limit by one when a truncation probe was requested.';
