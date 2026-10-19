-- Remove the seeded test logins from persistent environments.
--
-- supabase/seed.sql creates two users with a password that is public in this
-- repository: test@example.com (approved admin) and member@example.com
-- (member). The persistent dev branch (main.admin.jacwohlen.ch) used to be
-- seeded too ([remotes.dev.db.seed] in config.toml, now disabled), so anyone
-- could sign in there as admin. This migration deletes exactly those two
-- users, matched by their fixed id AND e-mail address.
--
-- Prod is never seeded and has no such users, so it is a no-op there.
-- Preview branches and local databases (`supabase db reset`) run all
-- migrations first and seed.sql afterwards, so they still get both users
-- from the seed.
--
-- user_profiles and auth.identities (and the other auth.* tables) cascade;
-- trial_emails, app_settings and user_profiles.approved_by are SET NULL.
-- lesson_plans.created_by has no ON DELETE action, so it is cleared first.
--
-- The protect_last_admin trigger would abort the cascade if the seeded admin
-- were the only approved admin left on dev. Removing a login with a public
-- password matters more, so the guard is switched off for this one delete
-- (inside the migration's transaction). If dev ends up without an admin, the
-- bootstrap admin (is_bootstrap_admin()) or an UPDATE in the dashboard's SQL
-- editor restores one.

UPDATE public.lesson_plans
SET created_by = NULL
WHERE created_by IN (
  SELECT id FROM auth.users
  WHERE (id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' AND email = 'test@example.com')
     OR (id = 'b2c3d4e5-f6a7-8901-bcde-f12345678901' AND email = 'member@example.com')
);

ALTER TABLE public.user_profiles DISABLE TRIGGER protect_last_admin;

DELETE FROM auth.users
WHERE (id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' AND email = 'test@example.com')
   OR (id = 'b2c3d4e5-f6a7-8901-bcde-f12345678901' AND email = 'member@example.com');

ALTER TABLE public.user_profiles ENABLE TRIGGER protect_last_admin;
