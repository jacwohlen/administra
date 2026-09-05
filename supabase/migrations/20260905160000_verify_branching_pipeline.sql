-- No-op migration to verify the Supabase branching pipeline end to end:
-- preview branch creation on PR, migration checks, and deployment to the
-- Dev (merge to main) and Prod (promote to prod) projects.
-- See docs/SUPABASE_BRANCHING.md.
select 1;
