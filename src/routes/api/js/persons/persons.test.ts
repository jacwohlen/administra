import { describe, expect, it, vi } from 'vitest';
import type { CourseData } from '$lib/jsCourseData';

const loadCourseData = vi.fn();
const fetchWeblingMembers = vi.fn();
vi.mock('$lib/jsCourseData', () => ({ loadCourseData }));
vi.mock('$lib/server/webling', () => ({
  fetchWeblingMembers,
  isWeblingConfigured: () => true,
  WeblingError: class extends Error {}
}));

const { GET } = await import('./+server');

const course: CourseData = {
  course: {
    id: 1,
    course_number: '',
    title: 'Judo',
    date_from: '2026-01-01',
    date_to: '2026-12-31',
    location: 'Dojo',
    durations: [60, 75, 90]
  },
  trainings: [{ id: 3, title: 'Judo', dateFrom: '18:00', dateTo: '19:30' }],
  logs: [
    { date: '2026-03-02', trainingId: 3, memberId: 10, trainerRole: 'attendee' },
    { date: '2026-03-02', trainingId: 3, memberId: 11, trainerRole: 'main_trainer' }
  ],
  members: [
    { id: 10, firstname: 'Arti', lastname: 'Muster', jsPersonNumber: null },
    { id: 11, firstname: 'Tina', lastname: 'Trainer', jsPersonNumber: '266750' }
  ]
};

async function call(role: string | null, query = 'courseId=1&role=participants') {
  const profile = role ? { role, status: 'approved' } : null;
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error: null });
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) };
  const url = new URL(`http://localhost/api/js/persons?${query}`);
  try {
    const response = await GET({
      url,
      locals: { supabase, safeGetSession: async () => ({ user: { id: 'u1' } }) }
    } as unknown as Parameters<typeof GET>[0]);
    return { status: response.status, body: await response.json() };
  } catch (e) {
    return e as { status: number; body: { message: string } };
  }
}

describe('GET /api/js/persons', () => {
  it('is for admins only', async () => {
    for (const role of ['trainer', 'viewer', 'member', null]) {
      expect((await call(role)).status).toBe(403);
    }
    expect(fetchWeblingMembers).not.toHaveBeenCalled();
  });

  it('checks the parameters', async () => {
    expect((await call('admin', 'courseId=1&role=all')).status).toBe(400);
  });

  it('returns the Webling data of the participants and what is missing', async () => {
    loadCourseData.mockResolvedValue(course);
    fetchWeblingMembers.mockResolvedValue([
      { id: 10, properties: { Name: 'Muster', Vorname: 'Arti', Geburtstag: '2014-05-10' } },
      { id: 11, properties: { Name: 'Trainer', Vorname: 'Tina' } }
    ]);
    const result = await call('admin');
    expect(result.status).toBe(200);
    expect(result.body.rows).toHaveLength(1);
    expect(result.body.rows[0].slice(0, 4)).toEqual(['', 'Muster', 'Arti', '10.05.2014']);
    expect(result.body.problems).toEqual([
      {
        id: 10,
        name: 'Muster Arti',
        missing: ['GESCHLECHT', 'NATIONALITAET', 'MUTTERSPRACHE', 'PLZ', 'ORT', 'AHV_NR']
      }
    ]);
  });

  it('returns the leaders on request', async () => {
    loadCourseData.mockResolvedValue(course);
    fetchWeblingMembers.mockResolvedValue([{ id: 11, properties: { Lizenznummer: '266750' } }]);
    const result = await call('admin', 'courseId=1&role=leaders');
    expect(result.body.rows.map((r: string[]) => r[0])).toEqual(['266750']);
  });
});
