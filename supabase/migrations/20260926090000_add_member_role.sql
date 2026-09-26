-- New user role for club members who sign in themselves.
--
-- Kept in its own migration: Postgres does not allow a freshly added enum
-- value to be used in the same transaction that adds it, and the next
-- migration (20260926090100_member_self_service.sql) uses it right away.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'member' BEFORE 'viewer';
