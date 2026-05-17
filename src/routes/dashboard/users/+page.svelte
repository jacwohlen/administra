<script lang="ts">
  import type { PageData } from './$types';
  import type { UserRole, UserStatus } from '$lib/models';
  import Fa from 'svelte-fa';
  import { faCheck, faBan, faRotateLeft, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidateAll } from '$app/navigation';

  let { data }: { data: PageData } = $props();
  let busyId = $state<string | null>(null);

  let statusBadgeClass = (s: UserStatus) =>
    s === 'approved'
      ? 'badge preset-filled-success-500'
      : s === 'pending'
        ? 'badge preset-filled-warning-500'
        : 'badge preset-filled-error-500';

  async function patch(userId: string, patch: Record<string, unknown>, successKey: string) {
    busyId = userId;
    try {
      const { error } = await supabaseClient
        .from('user_profiles')
        .update(patch)
        .eq('user_id', userId);
      if (error) throw error;
      toaster.success({ title: $_(successKey) });
      await invalidateAll();
    } catch (e) {
      toaster.error({ title: (e as Error).message });
    } finally {
      busyId = null;
    }
  }

  function approve(userId: string) {
    return patch(
      userId,
      { status: 'approved', approved_at: new Date().toISOString() },
      'page.users.toast.approved'
    );
  }

  function disable(userId: string) {
    return patch(userId, { status: 'disabled' }, 'page.users.toast.disabled');
  }

  function reEnable(userId: string) {
    return patch(
      userId,
      { status: 'approved', approved_at: new Date().toISOString() },
      'page.users.toast.approved'
    );
  }

  async function changeRole(userId: string, role: UserRole) {
    return patch(userId, { role }, 'page.users.toast.roleChanged');
  }

  async function changeMember(userId: string, value: string) {
    const member_id = value === '' ? null : Number(value);
    return patch(userId, { member_id }, 'page.users.toast.memberLinked');
  }

  async function remove(userId: string) {
    if (!confirm($_('page.users.confirmDelete'))) return;
    busyId = userId;
    try {
      const { error } = await supabaseClient.from('user_profiles').delete().eq('user_id', userId);
      if (error) throw error;
      toaster.success({ title: $_('page.users.toast.deleted') });
      await invalidateAll();
    } catch (e) {
      toaster.error({ title: (e as Error).message });
    } finally {
      busyId = null;
    }
  }
</script>

<div class="space-y-4">
  <h1 class="h2">{$_('page.users.title')}</h1>
  <p class="opacity-70 text-sm">{$_('page.users.subtitle')}</p>

  <div class="table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>{$_('page.users.cols.user')}</th>
          <th>{$_('page.users.cols.status')}</th>
          <th>{$_('page.users.cols.role')}</th>
          <th>{$_('page.users.cols.member')}</th>
          <th class="text-right">{$_('page.users.cols.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {#each data.profiles as p (p.user_id)}
          <tr>
            <td>
              <div class="flex items-center gap-2">
                {#if p.avatar_url}
                  <img src={p.avatar_url} alt="" class="size-8 rounded-full object-cover" />
                {:else}
                  <div
                    class="size-8 rounded-full bg-surface-200-800 flex items-center justify-center text-xs"
                  >
                    {(p.full_name || p.email).charAt(0).toUpperCase()}
                  </div>
                {/if}
                <div class="min-w-0">
                  <div class="font-medium truncate">{p.full_name || '—'}</div>
                  <div class="text-xs opacity-70 truncate">{p.email}</div>
                </div>
              </div>
            </td>
            <td>
              <span class={statusBadgeClass(p.status)}>
                {$_(`page.users.status.${p.status}`)}
              </span>
            </td>
            <td>
              <select
                class="select"
                value={p.role}
                disabled={busyId === p.user_id}
                onchange={(e) =>
                  changeRole(p.user_id, (e.target as HTMLSelectElement).value as UserRole)}
              >
                <option value="viewer">{$_('page.users.role.viewer')}</option>
                <option value="trainer">{$_('page.users.role.trainer')}</option>
                <option value="admin">{$_('page.users.role.admin')}</option>
              </select>
            </td>
            <td>
              <select
                class="select"
                value={p.member_id ?? ''}
                disabled={busyId === p.user_id}
                onchange={(e) => changeMember(p.user_id, (e.target as HTMLSelectElement).value)}
              >
                <option value="">{$_('page.users.unlinked')}</option>
                {#each data.members as m (m.id)}
                  <option value={m.id}>{m.lastname} {m.firstname}</option>
                {/each}
              </select>
            </td>
            <td class="text-right whitespace-nowrap">
              {#if p.status === 'pending'}
                <button
                  class="btn btn-sm preset-filled-success-500"
                  disabled={busyId === p.user_id}
                  onclick={() => approve(p.user_id)}
                  title={$_('page.users.action.approve')}
                >
                  <Fa icon={faCheck} />
                </button>
              {:else if p.status === 'approved'}
                <button
                  class="btn btn-sm preset-tonal"
                  disabled={busyId === p.user_id}
                  onclick={() => disable(p.user_id)}
                  title={$_('page.users.action.disable')}
                >
                  <Fa icon={faBan} />
                </button>
              {:else}
                <button
                  class="btn btn-sm preset-filled-success-500"
                  disabled={busyId === p.user_id}
                  onclick={() => reEnable(p.user_id)}
                  title={$_('page.users.action.reEnable')}
                >
                  <Fa icon={faRotateLeft} />
                </button>
              {/if}
              <button
                class="btn btn-sm preset-tonal-error ml-1"
                disabled={busyId === p.user_id || p.user_id === data.session?.user?.id}
                onclick={() => remove(p.user_id)}
                title={$_('page.users.action.delete')}
              >
                <Fa icon={faTrash} />
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if data.profiles.length === 0}
    <div class="text-center opacity-70 py-8">{$_('page.users.empty')}</div>
  {/if}
</div>
