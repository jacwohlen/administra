-- Migration: Replace logs.id (smallint) with composite primary key
-- The id column was smallint (max 32,767) and caused "duplicate key value violates
-- unique constraint logs_pkey" errors. The id is never used in application code;
-- all queries use (memberId, trainingId, date) as the natural key.

-- Step 1: Remove duplicate rows, keeping only one entry per (date, trainingId, memberId).
-- For duplicates, keep the row with the highest id (most recent insert).
DELETE FROM public.logs
WHERE id NOT IN (
  SELECT MAX(id)
  FROM public.logs
  GROUP BY date, "trainingId", "memberId"
);

-- Step 2: Drop the old primary key and id column
ALTER TABLE public.logs DROP CONSTRAINT logs_pkey;
ALTER TABLE public.logs DROP COLUMN id;

-- Step 3: Add composite primary key on the natural key columns
ALTER TABLE public.logs ADD CONSTRAINT logs_pkey PRIMARY KEY (date, "trainingId", "memberId");
