-- Two of the calendars seeded in 20261029120000 had guessed names: Webling
-- calls them 'Aikido Agenda' and 'Club Agenda', not 'Aikido' and 'Club'.
-- A layer run (a dry run too) registers the real calendar as a new row, not
-- reviewed, and the guess stays unbound: the Integrations page then lists
-- eight calendars for Webling's six. Where the real calendar came in already,
-- the guess goes and the real one counts as reviewed if it got the guess's
-- mapping; where it has not, the guess takes the real name so the first run
-- binds it.

UPDATE public.integration_calendars c
   SET reviewed = true, updated_at = now()
  FROM public.integration_calendars g
 WHERE g.connection = 'webling' AND g.external_id IS NULL AND g.name IN ('Aikido', 'Club')
   AND c.connection = 'webling' AND c.external_id IS NOT NULL AND c.name = g.name || ' Agenda'
   AND NOT c.reviewed
   AND c.target = g.target AND c.section IS NOT DISTINCT FROM g.section
   AND c.closed_max_days IS NOT DISTINCT FROM g.closed_max_days;

DELETE FROM public.integration_calendars g
 WHERE g.connection = 'webling' AND g.external_id IS NULL AND g.name IN ('Aikido', 'Club')
   AND EXISTS (SELECT 1 FROM public.integration_calendars c
                WHERE c.connection = 'webling' AND c.name = g.name || ' Agenda');

UPDATE public.integration_calendars
   SET name = name || ' Agenda', updated_at = now()
 WHERE connection = 'webling' AND external_id IS NULL AND name IN ('Aikido', 'Club');
