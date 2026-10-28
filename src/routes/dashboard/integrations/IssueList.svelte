<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faCodeMerge, faEyeSlash, faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import type { MergeMember } from '$lib/memberMerge';
  import {
    groupIssues,
    type IntegrationIssue,
    type IssueEvent,
    type IssueSeverity
  } from '$lib/integrations';
  import MergeMemberDialog from '../members/[memberId]/MergeMemberDialog.svelte';

  /**
   * Open and dismissed issues of a connection, grouped by code. Possible
   * duplicates link both members and open the merge dialog (phase 1c); an
   * admin can dismiss any issue ("Kein Duplikat" for a duplicate), and it
   * stays dismissed while runs keep seeing it, until reopened.
   */
  let {
    issues,
    members,
    events,
    provider,
    onchanged
  }: {
    issues: IntegrationIssue[];
    members: Map<number, MergeMember>;
    events: Map<number, IssueEvent>;
    /** The connection's display name */
    provider: string;
    /** An issue was dismissed or reopened, or a duplicate merged */
    onchanged: () => void;
  } = $props();

  let busyId = $state<number | null>(null);
  let merging = $state<{ first: MergeMember; second: MergeMember } | null>(null);

  let groups = $derived(
    groupIssues(issues, { member: (id) => members.has(id), event: (id) => events.has(id) })
  );

  const SEVERITY_CLASS: Record<IssueSeverity, string> = {
    error: 'preset-tonal-error',
    warning: 'preset-tonal-warning',
    info: 'preset-tonal-surface'
  };

  function codeLabel(code: string): string {
    return $_(`page.integrations.issues.code.${code}`, { default: code });
  }

  function codeHelp(kind: string, code: string): string {
    return $_(`page.integrations.issues.help.${kind}.${code}`, { default: '' });
  }

  function record(externalId: string): string {
    return $_('page.integrations.issues.record', { values: { provider, id: externalId } });
  }

  function memberName(id: number | null): string | null {
    const m = id == null ? undefined : members.get(id);
    return m ? `${m.lastname} ${m.firstname}` : null;
  }

  async function setDismissed(issue: IntegrationIssue, dismiss: boolean) {
    busyId = issue.id;
    try {
      const { error } = await supabaseClient.rpc('integration_dismiss_issue', {
        p_issue: issue.id,
        p_dismiss: dismiss
      });
      if (error) throw error;
      toaster.success({
        title: $_(
          dismiss
            ? 'page.integrations.issues.toast.dismissed'
            : 'page.integrations.issues.toast.reopened'
        )
      });
      onchanged();
    } catch (e) {
      console.error('Error dismissing an integration issue:', e);
      toaster.error({ title: $_('page.integrations.issues.toast.error') });
    } finally {
      busyId = null;
    }
  }
</script>

{#snippet memberLink(id: number)}
  <a href="/dashboard/members/{id}" class="anchor font-medium">{memberName(id)}</a>
{/snippet}

{#snippet subject(issue: IntegrationIssue)}
  {#if issue.code === 'possible_duplicate'}
    {#if issue.member_id != null}
      {@render memberLink(issue.member_id)}
    {:else}
      <span>{record(issue.external_id)}</span>
    {/if}
    <span aria-hidden="true">↔</span>
    {#if issue.other_member_id != null}
      {@render memberLink(issue.other_member_id)}
    {/if}
    {#if issue.detail}
      <span class="chip preset-tonal-surface text-xs">
        {$_(`page.integrations.issues.match.${issue.detail}`, { default: issue.detail })}
      </span>
    {/if}
  {:else}
    {#if issue.member_id != null}
      {@render memberLink(issue.member_id)}
    {/if}
    {#if issue.event_id != null && events.get(issue.event_id)}
      {@const event = events.get(issue.event_id)!}
      <a href="/dashboard/events/{event.id}" class="anchor font-medium">{event.title}</a>
      <span class="text-surface-600-400">{dayjs(event.date).format('DD.MM.YYYY')}</span>
    {/if}
    {#if issue.code === 'unknown_participant'}
      <span class="text-surface-600-400">
        {$_('page.integrations.issues.participant', {
          values: { provider, id: issue.external_id }
        })}
      </span>
    {:else if issue.external_id && (issue.member_id == null || issue.kind === 'events')}
      <span class="text-surface-600-400">{record(issue.external_id)}</span>
    {/if}
    {#if issue.detail}
      <code class="code text-xs">{issue.detail}</code>
    {/if}
  {/if}
{/snippet}

{#if groups.length === 0}
  <p class="text-sm text-surface-600-400">{$_('page.integrations.issues.empty')}</p>
{:else}
  <div class="flex flex-col gap-2">
    {#each groups as group (`${group.kind}:${group.code}`)}
      <details
        class="rounded-md border border-surface-200-800 px-3 py-2"
        open={group.severity === 'error' && group.open.length > 0}
      >
        <summary class="cursor-pointer">
          <span class="inline-flex flex-wrap items-center gap-2 align-middle">
            <span class="chip text-xs {SEVERITY_CLASS[group.severity]}">
              {$_(`page.integrations.issues.severity.${group.severity}`)}
            </span>
            <span class="font-medium">{codeLabel(group.code)}</span>
            <span class="text-xs text-surface-600-400">
              {$_(`page.integrations.kind.${group.kind}`)} · {group.open.length}
              {#if group.dismissed.length > 0}
                · {$_('page.integrations.issues.dismissedCount', {
                  values: { count: group.dismissed.length }
                })}
              {/if}
            </span>
          </span>
        </summary>
        <div class="flex flex-col gap-2 pt-2">
          {#if codeHelp(group.kind, group.code)}
            <p class="text-sm text-surface-600-400">{codeHelp(group.kind, group.code)}</p>
          {/if}
          <ul class="flex flex-col gap-1">
            {#each group.open as issue (issue.id)}
              <li class="flex flex-wrap items-center gap-2 text-sm">
                <span class="flex flex-wrap items-center gap-1 flex-1 min-w-0">
                  {@render subject(issue)}
                </span>
                {#if issue.code === 'possible_duplicate' && issue.member_id != null && issue.other_member_id != null}
                  <button
                    type="button"
                    class="btn btn-sm preset-tonal-primary"
                    disabled={busyId === issue.id}
                    onclick={() =>
                      (merging = {
                        first: members.get(issue.member_id!)!,
                        second: members.get(issue.other_member_id!)!
                      })}
                  >
                    <Fa icon={faCodeMerge} />
                    <span>{$_('page.integrations.issues.merge')}</span>
                  </button>
                {/if}
                <button
                  type="button"
                  class="btn btn-sm preset-tonal-surface"
                  disabled={busyId === issue.id}
                  onclick={() => setDismissed(issue, true)}
                >
                  <Fa icon={faEyeSlash} />
                  <span>
                    {issue.code === 'possible_duplicate'
                      ? $_('page.integrations.issues.notDuplicate')
                      : $_('page.integrations.issues.dismiss')}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
          {#if group.dismissed.length > 0}
            <p class="text-xs font-medium text-surface-600-400 mt-1">
              {$_('page.integrations.issues.dismissed')}
            </p>
            <ul class="flex flex-col gap-1">
              {#each group.dismissed as issue (issue.id)}
                <li class="flex flex-wrap items-center gap-2 text-sm text-surface-600-400">
                  <span class="flex flex-wrap items-center gap-1 flex-1 min-w-0">
                    {@render subject(issue)}
                  </span>
                  <button
                    type="button"
                    class="btn btn-sm preset-tonal-surface"
                    disabled={busyId === issue.id}
                    onclick={() => setDismissed(issue, false)}
                  >
                    <Fa icon={faRotateLeft} />
                    <span>{$_('page.integrations.issues.reopen')}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </details>
    {/each}
  </div>
{/if}

{#if merging}
  <MergeMemberDialog
    first={merging.first}
    second={merging.second}
    onclose={() => (merging = null)}
    onmerged={() => {
      merging = null;
      onchanged();
    }}
  />
{/if}
