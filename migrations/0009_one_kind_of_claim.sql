-- A role was either an incumbent or a challenger. But a challenger, a
-- candidate in a runoff, the leader in a recount and a member-elect are one
-- thing at different stages: someone who may, probably will, or will hold the
-- seat from a day ahead. The dates and the certainty already say which, so the
-- kind goes, and a challenger becomes a possible holder from the next term.
--
-- `contest` stays, as what the claim still depends on, and gains the two
-- stages that come after election day.

-- A challenger had no dates. They may hold the seat from its next election, or
-- failing that from the body's next term.
UPDATE roles
SET certainty = 'possible',
    starts_on = COALESCE(
      starts_on,
      (SELECT s.next_election_on FROM seats s WHERE s.id = roles.seat_id),
      (SELECT b.next_term_on FROM seats s JOIN bodies b ON b.id = s.body_id WHERE s.id = roles.seat_id)
    )
WHERE kind = 'challenger';

-- Both columns carry a CHECK that SQLite cannot alter, so `contest` moves to a
-- new column that then takes its name, and `kind` is dropped.
ALTER TABLE roles ADD COLUMN depends_on TEXT CHECK (depends_on IN ('primary', 'general', 'runoff', 'recount'));
UPDATE roles SET depends_on = contest;
ALTER TABLE roles DROP COLUMN contest;
ALTER TABLE roles RENAME COLUMN depends_on TO contest;
ALTER TABLE roles DROP COLUMN kind;
