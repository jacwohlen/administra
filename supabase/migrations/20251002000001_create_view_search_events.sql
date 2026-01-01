-- Create view for searching events
CREATE OR REPLACE VIEW public.view_search_events
WITH (security_invoker = on) AS
SELECT
    id,
    title,
    description,
    date,
    section,
    location,
    concat(title, ' ', COALESCE(description, ''), ' ', section, ' ', COALESCE(location, '')) AS searchtext
FROM public.events;