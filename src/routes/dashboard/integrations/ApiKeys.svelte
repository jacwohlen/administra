<script lang="ts">
  import { _ } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import Fa from 'svelte-fa';
  import { faCopy, faKey, faPen, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { modalDialog } from '#lib/modalDialog.ts';
  import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
  import { supabaseClient } from '#lib/supabase.ts';
  import { toaster } from '#lib/toast.ts';
  import {
    API_SCOPES,
    TRAINER_NAME_MODES,
    parseOrigins,
    scopesAllowOrigins,
    type ApiKeyRow,
    type ApiScope,
    type TrainerNameMode
  } from '#lib/publicApi.ts';

  /**
   * Admins: the API keys other systems (the club's website) use to read
   * Alleda under /api/v1/ (docs/API.md). A new key is shown once; editing
   * changes name, what it may read, websites (CORS) and how trainers are
   * named; deleting revokes it at once. A key for personal data (event
   * participants) is for servers only: it lists no websites.
   */
  let { keys, onchanged }: { keys: ApiKeyRow[]; onchanged: () => Promise<void> | void } = $props();

  type Draft = {
    id: string | null;
    name: string;
    scopes: ApiScope[];
    origins: string;
    trainerNames: TrainerNameMode;
  };

  /** The endpoint each scope opens, for the list and the example */
  const SCOPE_PATHS: Record<ApiScope, string[]> = {
    'training_plan:read': ['/api/v1/training-plan'],
    'event_participants:read': ['/api/v1/events', '/api/v1/events/{id}/participants']
  };
  const SCOPE_LABELS: Record<ApiScope, string> = {
    'training_plan:read': 'scopeTrainingPlan',
    'event_participants:read': 'scopeEventParticipants'
  };

  let draft = $state<Draft | null>(null);
  let saving = $state(false);
  /** The plaintext of the key just created, shown once */
  let created = $state<{ name: string; key: string; scopes: ApiScope[] } | null>(null);
  let revoking = $state<ApiKeyRow | null>(null);

  /** Websites only for keys without personal data */
  let originsAllowed = $derived(draft ? scopesAllowOrigins(draft.scopes) : true);
  let parsed = $derived(
    draft && originsAllowed ? parseOrigins(draft.origins) : { origins: [], invalid: [] }
  );
  let base = $derived(typeof window === 'undefined' ? '' : window.location.origin);

  /** The example for a new key: the first endpoint it may read */
  function example(scopes: ApiScope[]): string {
    if (scopes.includes('training_plan:read')) {
      return `${base}/api/v1/training-plan?from=${dayjs().format('YYYY-MM-DD')}`;
    }
    return `${base}/api/v1/events?from=${dayjs().subtract(30, 'day').format('YYYY-MM-DD')}`;
  }

  function toggleScope(scope: ApiScope, on: boolean) {
    if (!draft) return;
    draft.scopes = on
      ? API_SCOPES.filter((s) => s === scope || draft!.scopes.includes(s))
      : draft.scopes.filter((s) => s !== scope);
  }

  function startNew() {
    draft = {
      id: null,
      name: '',
      scopes: ['training_plan:read'],
      origins: '',
      trainerNames: 'full'
    };
  }

  function startEdit(key: ApiKeyRow) {
    draft = {
      id: key.id,
      name: key.name,
      scopes: [...key.scopes],
      origins: key.allowed_origins.join('\n'),
      trainerNames: key.trainer_names
    };
  }

  async function save() {
    if (!draft || !draft.name.trim() || draft.scopes.length === 0 || parsed.invalid.length > 0) {
      return;
    }
    saving = true;
    const { id, name, scopes, trainerNames } = draft;
    const origins = parsed.origins;
    if (id) {
      const { error } = await supabaseClient
        .from('api_keys')
        .update({
          name: name.trim(),
          scopes,
          allowed_origins: origins,
          trainer_names: trainerNames
        })
        .eq('id', id);
      saving = false;
      if (error) {
        toaster.error({ title: $_('page.integrations.api.saveError'), description: error.message });
        return;
      }
      toaster.success({ title: $_('page.integrations.api.saved') });
    } else {
      const { data, error } = await supabaseClient.rpc('api_key_create', {
        p_name: name.trim(),
        p_scopes: scopes,
        p_allowed_origins: origins,
        p_trainer_names: trainerNames
      });
      saving = false;
      const key = (data as { key?: unknown } | null)?.key;
      if (error || typeof key !== 'string') {
        toaster.error({
          title: $_('page.integrations.api.saveError'),
          description: error?.message
        });
        return;
      }
      created = { name: name.trim(), key, scopes };
    }
    draft = null;
    await onchanged();
  }

  async function revoke() {
    if (!revoking) return;
    saving = true;
    const { error } = await supabaseClient.from('api_keys').delete().eq('id', revoking.id);
    saving = false;
    if (error) {
      toaster.error({ title: $_('page.integrations.api.revokeError'), description: error.message });
      return;
    }
    toaster.success({
      title: $_('page.integrations.api.revoked', { values: { name: revoking.name } })
    });
    revoking = null;
    await onchanged();
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toaster.success({ title: $_('page.integrations.api.copied') });
    } catch {
      toaster.error({ title: $_('page.integrations.api.copyError') });
    }
  }

  function formatDate(value: string | null): string {
    return value ? dayjs(value).format('DD.MM.YYYY HH:mm') : $_('page.integrations.api.never');
  }
</script>

<section class="card p-4 bg-surface-50-950 border border-surface-300-700 flex flex-col gap-3">
  <div class="flex flex-wrap items-center gap-2">
    <h2 class="flex-1 min-w-0 truncate mb-0">{$_('page.integrations.api.title')}</h2>
    <button type="button" class="btn btn-sm preset-filled-primary-500" onclick={startNew}>
      <Fa icon={faPlus} />
      <span>{$_('page.integrations.api.new')}</span>
    </button>
  </div>
  <p class="text-sm text-surface-600-400">{$_('page.integrations.api.intro')}</p>

  {#if keys.length === 0}
    <p class="text-sm text-surface-600-400">{$_('page.integrations.api.empty')}</p>
  {:else}
    <ul class="flex flex-col divide-y divide-surface-200-800">
      {#each keys as key (key.id)}
        <li class="flex flex-wrap items-start gap-2 py-2">
          <Fa icon={faKey} class="mt-1 text-surface-500" />
          <div class="flex-1 min-w-0">
            <div class="font-medium">{key.name}</div>
            <div class="font-mono text-xs text-surface-600-400">alleda_{key.prefix}…</div>
            <div class="text-xs text-surface-600-400">
              {key.scopes.map((s) => $_(`page.integrations.api.scopeShort.${s}`)).join(', ') ||
                $_('page.integrations.api.noScopes')}
            </div>
            <div class="text-xs text-surface-600-400">
              {#if key.scopes.includes('training_plan:read')}
                {$_(`page.integrations.api.trainerNames.${key.trainer_names}`)} ·
              {/if}
              {key.allowed_origins.length > 0
                ? key.allowed_origins.join(', ')
                : $_('page.integrations.api.serverOnly')}
            </div>
            <div class="text-xs text-surface-600-400">
              {$_('page.integrations.api.created', {
                values: { date: formatDate(key.created_at) }
              })}
              ·
              {$_('page.integrations.api.lastUsed', {
                values: { date: formatDate(key.last_used_at) }
              })}
            </div>
          </div>
          <div class="flex gap-1">
            <button
              type="button"
              class="btn-icon size-11 p-0 flex-none text-surface-600-400 hover:bg-surface-200-800"
              title={$_('page.integrations.api.edit')}
              aria-label={$_('page.integrations.api.edit')}
              onclick={() => startEdit(key)}
            >
              <Fa icon={faPen} />
            </button>
            <button
              type="button"
              class="btn-icon size-11 p-0 flex-none text-surface-600-400 hover:text-error-600-400 hover:bg-surface-200-800"
              title={$_('page.integrations.api.revoke')}
              aria-label={$_('page.integrations.api.revoke')}
              onclick={() => (revoking = key)}
            >
              <Fa icon={faTrash} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="text-xs text-surface-600-400">
    {#each API_SCOPES as scope (scope)}
      <p>
        {$_(`page.integrations.api.scopeShort.${scope}`)}:
        {#each SCOPE_PATHS[scope] as path, i (path)}
          {#if i > 0},{/if}
          <code class="break-all">GET {base}{path}</code>
        {/each}
      </p>
    {/each}
  </div>
</section>

{#if draft}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (draft = null)}
    onkeydown={(e) => {
      if (e.key === 'Escape') draft = null;
    }}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <form
      use:modalDialog
      class="card modal-dialog modal-dialog-lg max-h-[90vh] overflow-y-auto space-y-4"
      onclick={(e) => e.stopPropagation()}
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3>
        {draft.id ? $_('page.integrations.api.editTitle') : $_('page.integrations.api.newTitle')}
      </h3>

      <label class="label">
        <span>{$_('page.integrations.api.name')}</span>
        <input
          class="input"
          type="text"
          maxlength="100"
          required
          bind:value={draft.name}
          placeholder={$_('page.integrations.api.namePlaceholder')}
        />
      </label>

      <fieldset class="text-sm space-y-2">
        <legend class="font-medium">{$_('page.integrations.api.scopes')}</legend>
        {#each API_SCOPES as scope (scope)}
          <label class="flex items-start gap-2">
            <input
              class="checkbox mt-0.5"
              type="checkbox"
              checked={draft.scopes.includes(scope)}
              onchange={(e) => toggleScope(scope, e.currentTarget.checked)}
            />
            <span>{$_(`page.integrations.api.${SCOPE_LABELS[scope]}`)}</span>
          </label>
        {/each}
      </fieldset>

      {#if draft.scopes.includes('training_plan:read')}
        <label class="label">
          <span>{$_('page.integrations.api.trainerNamesLabel')}</span>
          <select class="select" bind:value={draft.trainerNames}>
            {#each TRAINER_NAME_MODES as mode (mode)}
              <option value={mode}>{$_(`page.integrations.api.trainerNames.${mode}`)}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if !originsAllowed}
        <p class="rounded-md bg-surface-100-900 px-3 py-2 text-sm">
          {$_('page.integrations.api.serverOnlyHint')}
        </p>
      {:else}
        <label class="label">
          <span>{$_('page.integrations.api.origins')}</span>
          <textarea
            class="textarea font-mono text-sm"
            rows="3"
            bind:value={draft.origins}
            placeholder="https://www.example.ch"
          ></textarea>
          <span class="block text-xs leading-snug text-surface-600-400">
            {$_('page.integrations.api.originsHint')}
          </span>
          {#if parsed.invalid.length > 0}
            <span class="block text-xs leading-snug text-error-600-400">
              {$_('page.integrations.api.originsInvalid', {
                values: { origins: parsed.invalid.join(', ') }
              })}
            </span>
          {/if}
        </label>
      {/if}

      {#if parsed.origins.length > 0}
        <p class="rounded-md bg-warning-500/10 px-3 py-2 text-sm text-warning-800-200">
          {$_('page.integrations.api.browserWarning')}
        </p>
      {/if}

      <footer class="flex justify-end gap-2">
        <button type="button" class="btn preset-tonal-surface" onclick={() => (draft = null)}>
          {$_('button.cancel')}
        </button>
        <button
          type="submit"
          class="btn preset-filled-primary-500"
          disabled={saving ||
            !draft.name.trim() ||
            draft.scopes.length === 0 ||
            parsed.invalid.length > 0}
        >
          {draft.id ? $_('button.save') : $_('page.integrations.api.create')}
        </button>
      </footer>
    </form>
  </div>
{/if}

{#if created}
  <div class="modal-overlay">
    <div use:modalDialog class="card modal-dialog modal-dialog-lg space-y-4">
      <h3>{$_('page.integrations.api.createdTitle', { values: { name: created.name } })}</h3>
      <p class="text-sm">{$_('page.integrations.api.createdOnce')}</p>
      <input
        class="input font-mono text-xs"
        type="text"
        readonly
        value={created.key}
        aria-label={$_('page.integrations.api.keyLabel')}
        onfocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        class="btn btn-sm preset-tonal-surface w-full"
        onclick={() => created && copy(created.key)}
      >
        <Fa icon={faCopy} size="xs" />
        <span>{$_('page.integrations.api.copy')}</span>
      </button>
      <p class="text-sm">{$_('page.integrations.api.example')}</p>
      <pre
        class="text-xs whitespace-pre-wrap break-all rounded-md bg-surface-100-900 p-2">curl -H "Authorization: Bearer {created.key}" \
  "{example(created.scopes)}"</pre>
      <footer class="flex justify-end">
        <button
          type="button"
          class="btn preset-filled-primary-500"
          onclick={() => (created = null)}
        >
          {$_('button.close')}
        </button>
      </footer>
    </div>
  </div>
{/if}

{#if revoking}
  <ConfirmDialog
    title={$_('page.integrations.api.revokeTitle', { values: { name: revoking.name } })}
    message={$_('page.integrations.api.revokeMessage')}
    confirmLabel={$_('page.integrations.api.revoke')}
    busy={saving}
    onconfirm={revoke}
    oncancel={() => (revoking = null)}
  />
{/if}
