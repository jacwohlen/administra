<script lang="ts">
  import type { PageData } from './$types';
  import type { UserProfile, UserRole, UserStatus } from '$lib/models';
  import Fa from 'svelte-fa';
  import { faCheck, faBan, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidateAll } from '$app/navigation';

  let { data }: { data: PageData } = $props();
  let busyId = $state<string | null>(null);
  let searchTerm = $state('');

  const STATUS_ORDER: UserStatus[] = ['pending', 'approved', 'disabled'];

  let currentUserId = $derived(data.session?.user?.id);
  let isSelf = $derived((userId: string) => userId === currentUserId);

  let search = $derived((p: UserProfile): boolean => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (p.full_name ?? '').toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  });

  let grouped = $derived(
    STATUS_ORDER.map((status) => ({
      status,
      profiles: data.profiles.filter((p) => p.status === status && search(p))
    })).filter((g) => g.profiles.length > 0)
  );

  let memberName = $derived((memberId?: number): string | null => {
    if (memberId == null) return null;
    const m = data.members.find((x) => Number(x.id) === memberId);
    return m ? `${m.lastname} ${m.firstname}` : null;
  });

  function initials(p: UserProfile): string {
    const source = p.full_name?.trim() || p.email;
    const parts = source.split(/\s+/);
    return parts.length >= 2
      ? parts[0].charAt(0) + parts[1].charAt(0)
      : source.charAt(0).toUpperCase();
  }

  function errorMessage(e: unknown): string {
    const msg = (e as Error)?.message ?? String(e);
    if (msg.includes('LAST_ADMIN')) return $_('page.users.error.lastAdmin');
    if (msg.includes('idx_user_profiles_member_id')) return $_('page.users.error.memberTaken');
    return msg;
  }

  async function patch(userId: string, patch: Record<string, unknown>, successKey: string) {
    busyId = userId;
    try {
      const { error } = await supabaseClient
        .from('user_profiles')
        .update(patch)
        .eq('user_id', userId);
      if (error) throw error;
      toaster.success({ title: $_(successKey) });
    } catch (e) {
      toaster.error({ title: errorMessage(e) });
    } finally {
      busyId = null;
      await invalidateAll();
    }
  }

  function approve(userId: string) {
    return patch(
      userId,
      {
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: currentUserId ?? null
      },
      'page.users.toast.approved'
    );
  }

  function disable(userId: string) {
    return patch(userId, { status: 'disabled' }, 'page.users.toast.disabled');
  }

  function changeRole(userId: string, role: UserRole) {
    return patch(userId, { role }, 'page.users.toast.roleChanged');
  }

  function changeMember(userId: string, value: string) {
    const member_id = value === '' ? null : Number(value);
    return patch(userId, { member_id }, 'page.users.toast.memberLinked');
  }
</script>

<div class="page-header">
  <h1>{$_('page.users.title')}</h1>
</div>

<div class="mb-4">
  <input
    class="input"
    bind:value={searchTerm}
    type="text"
    placeholder={$_('page.users.searchPlaceholder')}
  />
</div>

{#if grouped.length === 0}
  <p class="text-center text-surface-600-400 py-8">{$_('page.users.empty')}</p>
{/if}

<ul class="flex flex-col gap-2">
  {#each grouped as group (group.status)}
    <h3 class="mt-4 mb-1">
      {$_(`page.users.status.${group.status}`)}
      <span class="text-sm text-surface-600-400 font-normal">({group.profiles.length})</span>
    </h3>
    {#each group.profiles as p (p.user_id)}
      <li class="list-item">
        <div class="relative inline-block flex-shrink-0">
          {#if p.avatar_url}
            <img src={p.avatar_url} alt="" class="size-10 rounded-full object-cover" />
          {:else}
            <div class="avatar-initials">{initials(p)}</div>
          {/if}
        </div>
        <span class="list-item-content">
          <dt class="font-bold truncate">
            {p.full_name || p.email}
            {#if isSelf(p.user_id)}
              <span class="chip preset-tonal-secondary text-xs ml-1">{$_('page.users.you')}</span>
            {/if}
          </dt>
          <dd class="text-sm text-surface-600-400 truncate">
            {p.email}
            {#if memberName(p.member_id)}
              &middot; {memberName(p.member_id)}
            {/if}
          </dd>
          <dd class="flex flex-wrap gap-2 mt-1">
            <select
              class="select w-auto text-sm py-1"
              value={p.role}
              disabled={busyId === p.user_id || isSelf(p.user_id)}
              title={isSelf(p.user_id) ? $_('page.users.selfLocked') : $_('page.users.roleLabel')}
              onchange={(e) =>
                changeRole(p.user_id, (e.target as HTMLSelectElement).value as UserRole)}
            >
              <option value="viewer">{$_('page.users.role.viewer')}</option>
              <option value="trainer">{$_('page.users.role.trainer')}</option>
              <option value="admin">{$_('page.users.role.admin')}</option>
            </select>
            <select
              class="select w-auto max-w-48 text-sm py-1"
              value={p.member_id ?? ''}
              disabled={busyId === p.user_id}
              title={$_('page.users.memberLabel')}
              onchange={(e) => changeMember(p.user_id, (e.target as HTMLSelectElement).value)}
            >
              <option value="">{$_('page.users.unlinked')}</option>
              {#each data.members as m (m.id)}
                <option value={m.id}>{m.lastname} {m.firstname}</option>
              {/each}
            </select>
          </dd>
        </span>
        {#if p.status === 'pending'}
          <button
            class="btn preset-filled-primary-500 flex-shrink-0"
            disabled={busyId === p.user_id}
            onclick={() => approve(p.user_id)}
            title={$_('page.users.action.approve')}
          >
            <Fa icon={faCheck} />
            <span class="hidden sm:inline">{$_('page.users.action.approve')}</span>
          </button>
        {:else if p.status === 'approved'}
          <button
            class="btn preset-tonal-primary flex-shrink-0"
            disabled={busyId === p.user_id || isSelf(p.user_id)}
            onclick={() => disable(p.user_id)}
            title={isSelf(p.user_id)
              ? $_('page.users.selfLocked')
              : $_('page.users.action.disable')}
          >
            <Fa icon={faBan} />
            <span class="hidden sm:inline">{$_('page.users.action.disable')}</span>
          </button>
        {:else}
          <button
            class="btn preset-tonal-primary flex-shrink-0"
            disabled={busyId === p.user_id}
            onclick={() => approve(p.user_id)}
            title={$_('page.users.action.reEnable')}
          >
            <Fa icon={faRotateLeft} />
            <span class="hidden sm:inline">{$_('page.users.action.reEnable')}</span>
          </button>
        {/if}
      </li>
    {/each}
  {/each}
</ul>
