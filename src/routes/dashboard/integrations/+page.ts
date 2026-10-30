import { error, redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { fetchAllRows } from '$lib/assistant/attendance';
import { isAdmin } from '$lib/roles';
import { MERGE_COLUMNS, type MergeMember } from '$lib/memberMerge';
import {
  CALENDAR_COLUMNS,
  GROUP_COLUMNS,
  ISSUE_COLUMNS,
  RUN_COLUMNS,
  eventUrlTemplate,
  issueReferences,
  parseConnectionStatuses,
  type CalendarRow,
  type IntegrationIssue,
  type IntegrationRun,
  type IssueEvent,
  type MemberGroupRow
} from '$lib/integrations';
import type { PageLoad } from './$types';

/** Runs the table shows */
const RUN_LIMIT = 50;
/** Ids per .in() filter, so the request URL stays short */
const ID_CHUNK = 200;

async function byIds<T>(table: string, columns: string, ids: number[]): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error: e } = await supabaseClient
      .from(table)
      .select(columns)
      .in('id', ids.slice(i, i + ID_CHUNK));
    if (e) throw e;
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

/**
 * Per connection, its link to events in the provider (eventUrlTemplate():
 * "In Webling öffnen" on issues about events). Not worth failing the page
 * for: without it the issues show no link.
 */
async function loadEventUrls(): Promise<Record<string, string>> {
  const { data, error: e } = await supabaseClient
    .from('integration_connections')
    .select('id, settings')
    .returns<{ id: string; settings: unknown }[]>();
  if (e) {
    console.error('Error loading the integration connections:', e);
    return {};
  }
  return Object.fromEntries(
    (data ?? []).flatMap((c) => {
      const template = eventUrlTemplate(c.settings);
      return template ? [[c.id, template]] : [];
    })
  );
}

/** Connections, runs, issues and the mapping of the integration layer: admins */
export const load: PageLoad = async ({ parent, depends }) => {
  const { userProfile } = await parent();
  if (!isAdmin(userProfile)) {
    redirect(303, '/dashboard');
  }
  depends('integrations:page');

  const status = await supabaseClient.rpc('integration_status');
  if (status.error) {
    error(500, status.error.message);
  }

  try {
    const [runs, issues, groups, calendars, eventUrls] = await Promise.all([
      supabaseClient
        .from('integration_runs')
        .select(RUN_COLUMNS)
        // A mapping preview is a dry config run each time: not worth a row
        .or('kind.neq.config,dry_run.is.false')
        .order('started_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(RUN_LIMIT),
      // Open and dismissed; resolved ones are history
      fetchAllRows<IntegrationIssue>((from, to) =>
        supabaseClient
          .from('integration_issues')
          .select(ISSUE_COLUMNS)
          .is('resolved_at', null)
          .order('id')
          .range(from, to)
      ),
      fetchAllRows<MemberGroupRow>((from, to) =>
        supabaseClient
          .from('integration_member_groups')
          .select(GROUP_COLUMNS)
          .order('connection')
          .order('id')
          .range(from, to)
      ),
      fetchAllRows<CalendarRow>((from, to) =>
        supabaseClient
          .from('integration_calendars')
          .select(CALENDAR_COLUMNS)
          .order('connection')
          .order('id')
          .range(from, to)
      ),
      loadEventUrls()
    ]);
    if (runs.error) throw runs.error;

    // Names for the issues (the log itself holds ids only)
    const refs = issueReferences(issues);
    const [members, events] = await Promise.all([
      byIds<MergeMember>('members', MERGE_COLUMNS, refs.members),
      byIds<IssueEvent>('events', 'id, title, date', refs.events)
    ]);

    return {
      connections: parseConnectionStatuses(status.data),
      runs: (runs.data ?? []) as IntegrationRun[],
      issues,
      members: members.map((m) => ({ ...m, id: Number(m.id) })),
      events: events.map((e) => ({ ...e, id: Number(e.id) })),
      groups,
      calendars,
      eventUrls
    };
  } catch (e) {
    error(500, (e as { message?: string } | null)?.message ?? 'Integrations not loaded');
  }
};
