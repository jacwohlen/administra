-- The search for people to add (check-in lists, exam candidates) shows each
-- person's age, to tell apart two with the same name. The column is appended
-- so the view can be replaced in place while the previous release still
-- reads the old columns. security_invoker keeps the members table's RLS.
CREATE OR REPLACE VIEW public.view_search_members
WITH (security_invoker = on) AS
SELECT
    id,
    concat(lastname, ' ', firstname) AS fullname,
    firstname,
    lastname,
    birthday
FROM public.members
WHERE "archivedAt" IS NULL;
