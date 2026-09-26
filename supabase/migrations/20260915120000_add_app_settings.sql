-- Admin-editable application settings.
--
-- Key/value rows (value is jsonb) that override the optional environment
-- defaults (PUBLIC_CLUB_*, PUBLIC_TRIAL_*, PUBLIC_DEFAULT_LOCALE) and the
-- app's built-in display defaults at runtime — see src/lib/appSettings.ts
-- for the merge and src/lib/appSettingsParser.ts for the known keys.
--
-- A missing row means "use the default", so the table starts empty and a
-- row only exists while an admin overrides that setting from
-- /dashboard/settings. Unknown or malformed values are ignored by the
-- frontend parser, never fatal.

CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Settings are non-sensitive display configuration (club name, sections,
-- list sizes, ...) and the public trial registration page needs them before
-- login, so anyone may read. Writes are admin-only. Role checks are wrapped
-- in a scalar subselect so they run once per statement, matching
-- 20260913150000_perf_rls_initplan_and_indexes.sql.
CREATE POLICY app_settings_read ON public.app_settings
  FOR SELECT USING (true);

CREATE POLICY app_settings_insert ON public.app_settings
  FOR INSERT WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY app_settings_update ON public.app_settings
  FOR UPDATE
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY app_settings_delete ON public.app_settings
  FOR DELETE USING ((SELECT public.is_admin()));
