<script lang="ts">
  import type { PageData } from './$types';
  import { SETTING_FIELDS, type SettingField, type SettingGroup } from '$lib/appSettingsParser';
  import { TRIAL_MAIL_KINDS, TRIAL_MAIL_PLACEHOLDERS } from '$lib/trialMail';
  import { invalidateAppSettings } from '$lib/appSettings';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { invalidateAll } from '$app/navigation';
  import { _ } from 'svelte-i18n';

  let { data }: { data: PageData } = $props();
  let busy = $state(false);

  const GROUPS: SettingGroup[] = ['club', 'trial', 'trialMail', 'display'];

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
    if (field.labelKey) return $_(field.labelKey, { values: localizedLabelValues(field) });
    return $_(`page.settings.field.${field.id}.label`);
  }

  function fieldDescription(field: SettingField): string {
    if (field.descriptionKey) {
      return $_(field.descriptionKey, { values: localizedLabelValues(field) });
    }
    return $_(`page.settings.field.${field.id}.description`);
  }

  /** Label values like the template kind and language, spelled out. */
  function localizedLabelValues(field: SettingField): Record<string, string> {
    const v = field.labelValues ?? {};
    return {
      ...v,
      ...(v.kind ? { kind: $_(`page.settings.trialMail.kind.${v.kind}`) } : {}),
      ...(v.locale ? { locale: $_(`page.settings.trialMail.locale.${v.locale}`) } : {})
    };
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

{#snippet fieldInput(field: SettingField)}
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
    {:else if field.kind === 'longtext'}
      <textarea
        id={field.key}
        class="textarea font-mono text-sm"
        rows="10"
        bind:value={inputs[field.key]}
        placeholder={toInput(field, data.defaults[field.key])}
        disabled={busy}
      ></textarea>
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
    {#if field.group === 'trialMail' && !inputs[field.key].trim()}
      <button
        type="button"
        class="btn btn-sm preset-tonal-surface self-start"
        disabled={busy}
        onclick={() => (inputs[field.key] = toInput(field, data.defaults[field.key]))}
      >
        {$_('page.settings.trialMail.useDefault')}
      </button>
    {/if}
    <span class="text-xs text-surface-600-400">
      {fieldDescription(field)}
      {#if field.kind !== 'locale' && field.group !== 'trialMail'}
        {defaultHint(field)}
      {/if}
    </span>
  </label>
{/snippet}

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
      {#if group === 'trialMail'}
        <p class="text-sm text-surface-600-400">
          {$_('page.settings.trialMail.intro')}
          {#each TRIAL_MAIL_PLACEHOLDERS as name, i (name)}<code class="code text-xs"
              >{'{' + name + '}'}</code
            >{i < TRIAL_MAIL_PLACEHOLDERS.length - 1 ? ', ' : ''}{/each}
        </p>
        {#each TRIAL_MAIL_KINDS as kind (kind)}
          {@const fields = SETTING_FIELDS.filter(
            (f) => f.group === group && f.labelValues?.kind === kind
          )}
          <details class="rounded-md border border-surface-200-800 px-3 py-2">
            <summary class="cursor-pointer font-medium">
              {$_(`page.settings.trialMail.kind.${kind}`)}
              {#if fields.some((f) => f.key in data.overrides)}
                <span class="chip preset-tonal-secondary text-xs ml-1">
                  {$_('page.settings.overridden')}
                </span>
              {/if}
            </summary>
            <div class="flex flex-col gap-4 pt-3">
              {#each fields as field (field.key)}
                {@render fieldInput(field)}
              {/each}
            </div>
          </details>
        {/each}
      {:else}
        {#each SETTING_FIELDS.filter((f) => f.group === group) as field (field.key)}
          {@render fieldInput(field)}
        {/each}
      {/if}
    </div>
  {/each}

  <div class="flex justify-end mt-4">
    <button type="submit" class="btn preset-filled-primary-500" disabled={busy || !dirty}>
      {$_('page.settings.save')}
    </button>
  </div>
</form>
