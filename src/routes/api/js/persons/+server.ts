import { json, error, type RequestHandler } from '@sveltejs/kit';
import { loadCourseData } from '$lib/jsCourseData';
import { courseRoles } from '$lib/jsExport';
import { personRow } from '$lib/jsPersons';
import { fetchWeblingMembers, isWeblingConfigured, WeblingError } from '$lib/server/webling';

/**
 * Rows of the J+S person import for a course: everyone who attended (role
 * "participants") or led (role "leaders") a training of the course, with
 * the data the NDS needs from Webling. Admins only: the rows hold AHV
 * numbers and addresses. Nothing of it is stored or logged.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  const { user } = await locals.safeGetSession();
  if (!user) error(401, 'Not signed in');

  const { data: profile } = await locals.supabase
    .from('user_profiles')
    .select('role, status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profile?.status !== 'approved' || profile.role !== 'admin') error(403, 'Admins only');

  const courseId = Number(url.searchParams.get('courseId'));
  const role = url.searchParams.get('role');
  if (!Number.isInteger(courseId) || (role !== 'participants' && role !== 'leaders')) {
    error(400, 'courseId and role (participants or leaders) are required');
  }
  if (!isWeblingConfigured()) error(503, 'Webling is not configured');

  const data = await loadCourseData(locals.supabase, courseId);
  if (!data) error(404, 'Course not found');
  const { leaders, participants } = courseRoles(data.logs, data.members);
  const people = role === 'leaders' ? leaders : participants;

  let webling;
  try {
    webling = await fetchWeblingMembers();
  } catch (e) {
    if (e instanceof WeblingError) error(502, e.message);
    throw e;
  }
  const byId = new Map(webling.map((m) => [Number(m.id), m]));

  const rows: string[][] = [];
  const problems: { id: number; name: string; missing: string[] }[] = [];
  for (const person of people) {
    const name = `${person.lastname} ${person.firstname}`;
    const member = byId.get(person.id);
    if (!member) {
      problems.push({ id: person.id, name, missing: ['WEBLING'] });
      continue;
    }
    const { row, missing } = personRow(member.properties ?? {});
    rows.push(row);
    if (missing.length) problems.push({ id: person.id, name, missing });
  }

  return json({ rows, problems }, { headers: { 'Cache-Control': 'no-store' } });
};
