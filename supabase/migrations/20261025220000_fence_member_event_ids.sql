-- Keep ids the app hands out away from Webling ids.
--
-- members.id and events.id are identity columns, but the Webling sync writes
-- Webling ids into them (webling-sync/src/webling.py, events.py, upsert on the
-- primary key), while the app takes new ids from the same sequences (member
-- form, quick add on check-in, register_trial(), new events). Once a sequence
-- reached an id Webling uses, the app's insert would fail, or the next sync
-- would overwrite a different person's or event's row.
--
-- Webling ids are below 100'000 today, so both sequences continue at
-- 10'000'000 (or after the highest id, should that ever be higher). New
-- members and events created in the app get ids from 10'000'001 on.

SELECT setval(
  pg_get_serial_sequence('public.members', 'id'),
  GREATEST(10000000, (SELECT COALESCE(max(id), 0) FROM public.members))
);

SELECT setval(
  pg_get_serial_sequence('public.events', 'id'),
  GREATEST(10000000, (SELECT COALESCE(max(id), 0) FROM public.events))
);
