-- A pillar with zero assessed criteria has no score. 0.00 would mean
-- "failed every assessed check," which is a different fact.
-- Local only. Marcus applies hosted migrations himself.

ALTER TABLE pillar_results
  ALTER COLUMN score DROP NOT NULL;
