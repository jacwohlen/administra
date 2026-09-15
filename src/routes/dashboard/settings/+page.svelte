<script lang="ts">
  import type { PageData } from './$types';
  import { SETTING_FIELDS, type SettingField, type SettingGroup } from '$lib/appSettingsParser';
  import { invalidateAppSettings } from '$lib/appSettings';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidateAll } from '$app/navigation';
  import { _ } from 'svelte-i18n';

  let { data }: { data: PageData } = $props();
  let busy = $state(false);

  const GROUPS: SettingGroup[] = ['club', 'trial', 'display'];

  function toInput(field: SettingField, value: unknown): string {
    if (value == null) return '';
    if (field.kind === 'list' && Array.isArray(value)) return value.join(', ');
    return String(value);
  }

  let inputs = $state(
    Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, toInput(f, data.overrides[f.key])]))
  );

  let dirty = $derived(
    SETTING_FIELDS.some((f) => inputs[f.key].trim() !== toInput(f, data.overrides[f.key]))
  );

  function fieldLabel(field: SettingField): string {
    return $_(`page.settings.field.${field.id}.label`);
  }

  function defaultHint(field: SettingField): string {
    const value = toInput(field, data.defaults[field.key]);
    return $_('page.settings.defaultHint', { values: { value: value || '—' } });
  }

  /** Parse one input into its jsonb value, or null for "use the default". */
  function parseInput(field: SettingField, raw: string): unknown {
    switch (field.kind) {
      case 'int': {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < (field.min ?? 1)) {
          throw new Error(
            $_('page.settings.error.invalidNumber', {
              values: { label: fieldLabel(field), min: field.min ?? 1 }
            })
          );
        }
        return n;
      }
      case 'list': {
        const items = raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        if (items.length === 0) {
          throw new Error(
            $_('page.settings.error.emptyList', { values: { label: fieldLabel(field) } })
          );
        }
        return items;
      }
      default:
        return raw;
    }
  }

  async function save() {
    const upserts: {
      key: string;
      value: unknown;
      updated_at: string;
      updated_by: string | null;
    }[] = [];
    const deletes: string[] = [];
    try {
      for (const field of SETTING_FIELDS) {
        const raw = inputs[field.key].trim();
        if (!raw) {
          if (field.key in data.overrides) deletes.push(field.key);
          continue;
        }
        const value = parseInput(field, raw);
        if (JSON.stringify(data.overrides[field.key]) !== JSON.stringify(value)) {
          upserts.push({
            key: field.key,
            value,
            updated_at: new Date().toISOString(),
            updated_by: data.session?.user?.id ?? null
          });
        }
      }
    } catch (e) {
      toaster.error({ title: (e as Error).message });
      return;
    }
    if (upserts.length === 0 && deletes.length === 0) return;

    busy = true;
    try {
      if (upserts.length > 0) {
        const { error } = await supabaseClient.from('app_settings').upsert(upserts);
        if (error) throw error;
      }
      if (deletes.length > 0) {
        const { error } = await supabaseClient.from('app_settings').delete().in('key', deletes);
        if (error) throw error;
      }
      toaster.success({ title: $_('page.settings.toast.saved') });
    } catch (e) {
      toaster.error({ title: (e as Error)?.message ?? String(e) });
    } finally {
      // Refetch even after a partial failure — some rows may have changed.
      invalidateAppSettings();
      busy = false;
      await invalidateAll();
    }
  }
</script>

<div class="page-header">
  <h1>{$_('page.settings.title')}</h1>
</div>

<p class="text-sm text-surface-600-400 mb-4">{$_('page.settings.intro')}</p>

<form
  class="flex flex-col gap-2"
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
>
  {#each GROUPS as group (group)}
    <h3 class="mt-4 mb-1">{$_(`page.settings.group.${group}`)}</h3>
    <div class="card p-4 bg-surface-50-950 border border-surface-300-700 flex flex-col gap-4">
      {#each SETTING_FIELDS.filter((f) => f.group === group) as field (field.key)}
        <label class="label" for={field.key}>
          <span class="font-medium">
            {fieldLabel(field)}
            {#if field.key in data.overrides}
              <span class="chip preset-tonal-secondary text-xs ml-1">
                {$_('page.settings.overridden')}
              </span>
            {/if}
          </span>
          {#if field.kind === 'locale'}
            <select id={field.key} class="select" bind:value={inputs[field.key]} disabled={busy}>
              <option value="">{defaultHint(field)}</option>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          {:else if field.kind === 'int'}
            <!-- type="text": a number input would bind a number and break the
                 string-based "blank means default" handling -->
            <input
              id={field.key}
              class="input"
              type="text"
              inputmode="numeric"
              bind:value={inputs[field.key]}
              placeholder={toInput(field, data.defaults[field.key])}
              disabled={busy}
            />
          {:else}
            <input
              id={field.key}
              class="input"
              type="text"
              bind:value={inputs[field.key]}
              placeholder={toInput(field, data.defaults[field.key])}
              disabled={busy}
            />
          {/if}
          <span class="text-xs text-surface-600-400">
            {$_(`page.settings.field.${field.id}.description`)}
            {#if field.kind !== 'locale'}
              {defaultHint(field)}
            {/if}
          </span>
        </label>
      {/each}
    </div>
  {/each}

  <div class="flex justify-end mt-4">
    <button type="submit" class="btn preset-filled-primary-500" disabled={busy || !dirty}>
      {$_('page.settings.save')}
    </button>
  </div>
</form>
