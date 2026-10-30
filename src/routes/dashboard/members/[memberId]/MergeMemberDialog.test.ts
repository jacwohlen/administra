import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import type { MergeMember } from '$lib/memberMerge';
import type { MemberMergeResult } from '$lib/models';
import MergeMemberDialog from './MergeMemberDialog.svelte';

vi.mock('svelte-i18n', () => ({
  // The key, and for a contact field line also the values it names
  _: readable((key: string, opts?: { values?: Record<string, unknown> }) =>
    key.startsWith('page.members.merge.fieldDecision.') && opts?.values
      ? `${key} ${opts.values.field}=${opts.values.value}`
      : key
  ),
  locale: readable('de'),
  init: vi.fn(),
  register: vi.fn(),
  getLocaleFromNavigator: vi.fn()
}));

// Every call the dialog makes to the database and to Storage, in order
const { calls, mock } = vi.hoisted(() => {
  const calls: string[] = [];
  const mock = {
    rpc: vi.fn(),
    copy: vi.fn(),
    remove: vi.fn(),
    links: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn()
  };
  return { calls, mock };
});

vi.mock('$lib/supabase', () => ({
  supabaseClient: {
    rpc: (name: string, args: unknown) => {
      calls.push(`rpc ${name}`);
      return mock.rpc(name, args);
    },
    storage: {
      from: () => ({
        copy: (from: string, to: string) => {
          calls.push(`copy ${from} ${to}`);
          return mock.copy(from, to);
        },
        remove: (paths: string[]) => {
          calls.push(`remove ${paths.join(',')}`);
          return mock.remove(paths);
        }
      })
    }
  }
}));
// With the pair preset only the member links are loaded
vi.mock('$lib/assistant/attendance', () => ({ fetchAllRows: () => mock.links() }));
vi.mock('$lib/toast', () => ({
  toaster: { error: mock.toastError, success: mock.toastSuccess }
}));

const uploaded = '2026-05-01T10:00:00.123+00:00';
const ms = Date.parse(uploaded);

const webling: MergeMember = {
  id: 5101,
  firstname: 'Kim',
  lastname: 'Keller',
  membership_status: 'active',
  labels: ['Aktiv'],
  license_number: null
};
const trial: MergeMember = {
  id: 10000901,
  firstname: 'Kim',
  lastname: 'Keller',
  membership_status: 'trial',
  labels: ['probetraining'],
  // The dropped row's number: the dialog names it, also when it is not taken
  license_number: '4711'
};

function preview(): MemberMergeResult {
  return {
    keep: 5101,
    drop: 10000901,
    keepInProvider: true,
    status: { before: 'active', after: 'active' },
    moved: { 'logs.memberId': { moved: 6, merged: 1 } },
    conflicts: [
      {
        ref: 'member_medals.memberId',
        competition: 'Jugend Wettkampf',
        date: '2026-04-26',
        keptMedal: 'gold',
        droppedMedal: 'bronze',
        kept: 'drop'
      }
    ],
    fields: {
      birthday: 'same',
      mobile: 'same',
      email: 'not_copied_provider',
      notes: 'joined',
      photo: 'from_drop',
      dropPhotoUploaded: uploaded,
      archived: 'not_archived',
      labelsNotCarried: ['probetraining'],
      trial: 'from_drop',
      trialStatus: 'assigned'
    },
    accounts: [
      {
        userId: 'u1',
        email: 'parent@test.ch',
        role: 'member',
        before: true,
        after: false,
        findsBefore: true,
        findsAfter: false
      }
    ],
    warnings: ['EMAIL_NOT_COPIED', { code: 'ACCOUNT_LOSES_ACCESS', accounts: 1 }],
    badges: { added: [], removed: [], othersChanged: 0 }
  };
}

function open(onmerged = vi.fn()) {
  // Opened on the trial row: the Webling row must still be the one kept
  return render(MergeMemberDialog, {
    props: { first: trial, second: webling, onclose: vi.fn(), onmerged }
  });
}

async function confirmMerge(getAllByText: (text: string) => HTMLElement[]) {
  await waitFor(() => expect(getAllByText('page.members.merge.confirm')[0]).not.toBeDisabled());
  await fireEvent.click(getAllByText('page.members.merge.confirm')[0]);
  // The confirm dialog repeats the label on its own button
  await fireEvent.click(getAllByText('page.members.merge.confirm')[1]);
}

describe('MergeMemberDialog', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    mock.links.mockResolvedValue([{ member_id: 5101, gone_at: null }]);
    mock.copy.mockResolvedValue({ data: {}, error: null });
    mock.remove.mockResolvedValue({ data: [], error: null });
  });
  afterEach(() => cleanup());

  it('previews with the Webling row kept and cannot swap it away', async () => {
    mock.rpc.mockResolvedValue({ data: preview(), error: null });
    const { getByText, getByLabelText } = open();
    await waitFor(() => expect(getByText('page.members.merge.refs.attendance')).toBeTruthy());
    expect(mock.rpc).toHaveBeenCalledWith('merge_members_preview', {
      p_keep: 5101,
      p_drop: 10000901
    });
    expect(getByLabelText('page.members.merge.swap')).toBeDisabled();
    // Each conflict and each account that loses access on its own line
    expect(getByText('page.members.merge.conflict.medal')).toBeTruthy();
    expect(getByText('page.members.merge.account.losesAccess')).toBeTruthy();
    expect(getByText('page.members.merge.warning.ACCOUNT_LOSES_ACCESS')).toBeTruthy();
    expect(getByText('page.members.merge.statusSame')).toBeTruthy();
  });

  it('lists the licence number like the other contact fields, and not when the database has none', async () => {
    mock.rpc.mockResolvedValue({
      data: { ...preview(), fields: { ...preview().fields, license_number: 'kept_differs' } },
      error: null
    });
    const first = open();
    await waitFor(() =>
      expect(
        first.getByText(
          'page.members.merge.fieldDecision.kept_differs page.members.merge.field.license_number=4711'
        )
      ).toBeTruthy()
    );
    first.unmount();
    // A database before the licence number answers without the field
    mock.rpc.mockResolvedValue({ data: preview(), error: null });
    const second = open();
    await waitFor(() =>
      expect(second.getByText('page.members.merge.refs.attendance')).toBeTruthy()
    );
    expect(second.queryByText(/fieldDecision\.kept_differs/)).toBeNull();
    expect(second.getAllByText(/page\.members\.merge\.fieldDecision\./)).toHaveLength(1);
  });

  it('copies the photo the database names, merges, then removes the old file', async () => {
    const onmerged = vi.fn();
    // The merge answers what the preview said
    mock.rpc.mockResolvedValue({ data: preview(), error: null });
    const { getAllByText } = open(onmerged);
    await confirmMerge(getAllByText);
    await waitFor(() => expect(onmerged).toHaveBeenCalledWith(5101));
    expect(calls).toEqual([
      'rpc merge_members_preview',
      `copy 10000901_${ms}.webp 5101_${ms}.webp`,
      'rpc merge_members',
      `remove 10000901_${ms}.webp`
    ]);
    expect(mock.toastSuccess).toHaveBeenCalled();
  });

  it('takes the copy back when the merge is refused', async () => {
    const onmerged = vi.fn();
    mock.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'merge_members'
          ? { data: null, error: { message: 'ACCOUNT_CONFLICT' } }
          : { data: preview(), error: null }
      )
    );
    const { getAllByText } = open(onmerged);
    await confirmMerge(getAllByText);
    await waitFor(() =>
      expect(mock.toastError).toHaveBeenCalledWith({
        title: 'page.members.merge.error.ACCOUNT_CONFLICT'
      })
    );
    expect(calls.at(-1)).toBe(`remove 5101_${ms}.webp`);
    expect(onmerged).not.toHaveBeenCalled();
  });

  it('shows a refusal of the preview instead of the counts', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: 'BOTH_IN_PROVIDER' } });
    const { getByText, getAllByText } = open();
    await waitFor(() =>
      expect(getByText('page.members.merge.error.BOTH_IN_PROVIDER')).toBeTruthy()
    );
    expect(getAllByText('page.members.merge.confirm')[0]).toBeDisabled();
  });

  it('stops waiting when the preview request fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mock.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const { getByText, queryByText, getAllByText } = open();
    await waitFor(() => expect(getByText('page.members.merge.error.unknown')).toBeTruthy());
    expect(queryByText('page.members.merge.previewLoading')).toBeNull();
    expect(getAllByText('page.members.merge.confirm')[0]).toBeDisabled();
    spy.mockRestore();
  });
});
