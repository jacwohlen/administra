-- The J+S module is for trainers (and admins): viewers no longer read its
-- courses. Writing was already limited to them (is_writer()). The licence
-- number stays on the member record, readable like the rest of it.
ALTER POLICY js_courses_read ON public.js_courses USING ((SELECT public.is_writer()));
ALTER POLICY js_course_trainings_read ON public.js_course_trainings USING ((SELECT public.is_writer()));
