<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowDown,
    faArrowLeft,
    faArrowUp,
    faPlus,
    faTrash
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { clubConfig } from '$lib/clubConfig';
  import { toaster } from '$lib/toast';
  import { invalidateGradeDefinitions } from '$lib/referenceData';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import {
    copyRows,
    kyuDanTemplate,
    ladderChanged,
    ladderPayload,
    ladderProblems,
    ladderRows,
    ladderSections,
    MAX_GRADE_NAME,
    moveRow,
    newRowKey,
    removedGrades,
    toHexColor,
    usageKey,
    type LadderProblem,
    type LadderRow
  } from '$lib/gradeLadders';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Sections typed in here that are no club section (yet): listed until reload
  let extraSections = $state<string[]>([]);
  let sections = $derived(
    ladderSections([...clubConfig.sections, ...extraSections], data.gradeDefinitions)
  );
  let selected = $state('');
  let section = $derived(
    sections.some((s) => s.section === selected) ? selected : (sections[0]?.section ?? '')
  );
  let saved = $derived(ladderRows(data.gradeDefinitions, section));
  // Edits of the selected section; reset when the section or the saved ladder changes
  let rows = $derived<LadderRow[]>(saved);

  function update(index: number, patch: Partial<LadderRow>) {
    rows = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
  }

  let busy = $state(false);
  let confirmSave = $state(false);
  let newSection = $state('');
  let templateKyu = $state(6);
  let templateDan = $state(5);

  let problems = $derived(ladderProblems(rows));
  let dirty = $derived(ladderChanged(rows, saved));
  let removed = $derived(removedGrades(rows, saved));
  let otherLadders = $derived(sections.filter((s) => s.section !== section && s.grades > 0));

  function uses(row: LadderRow): number {
    return row.previous ? (data.usage[usageKey(section, row.previous)] ?? 0) : 0;
  }

  function problemText(p: LadderProblem): string {
    switch (p.kind) {
      case 'emptyName':
        return $_('page.gradeLadders.problem.emptyName', { values: { n: p.index + 1 } });
      case 'nameTooLong':
        return $_('page.gradeLadders.problem.nameTooLong', {
          values: { n: p.index + 1, max: MAX_GRADE_NAME }
        });
      case 'duplicate':
        return $_('page.gradeLadders.problem.duplicate', { values: { grade: p.grade } });
      case 'badColor':
        return $_('page.gradeLadders.problem.badColor', { values: { n: p.index + 1 } });
    }
  }

  function addRow() {
    const last = rows[rows.length - 1];
    rows = [
      ...rows,
      {
        key: newRowKey(),
        grade: '',
        previous: null,
        beltColor: last?.beltColor ?? '#f5f5f5',
        beltColor2: null,
        isDan: last?.isDan ?? false
      }
    ];
  }

  function removeRow(index: number) {
    rows = rows.filter((_, i) => i !== index);
  }

  function move(index: number, delta: -1 | 1) {
    rows = moveRow(rows, index, delta);
  }

  function startFromTemplate() {
    rows = copyRows(kyuDanTemplate(templateKyu, templateDan));
  }

  function startFromLadder(other: string) {
    rows = copyRows(ladderRows(data.gradeDefinitions, other));
  }

  function addSection() {
    const name = newSection.trim();
    if (!name) return;
    selected = name;
    newSection = '';
    if (!sections.some((s) => s.section === name)) extraSections = [...extraSections, name];
  }

  function errorMessage(e: { code?: string; message?: string } | null): string {
    const message = e?.message ?? '';
    if (e?.code === '23503') {
      return $_('page.gradeLadders.toast.inUse', {
        values: { grades: message.replace(/^grade in use: /, '') }
      });
    }
    if (e?.code === '23505') return $_('page.gradeLadders.toast.duplicate');
    if (e?.code === '40001') return $_('page.gradeLadders.toast.stale');
    if (e?.code === '42501') return $_('page.gradeLadders.toast.notAllowed');
    return $_('page.gradeLadders.toast.failed');
  }

  function requestSave() {
    if (problems.length > 0 || !dirty) return;
    if (removed.length > 0) confirmSave = true;
    else save();
  }

  async function save() {
    confirmSave = false;
    busy = true;
    const { error } = await supabaseClient.rpc('save_grade_ladder', {
      p_section: section,
      p_grades: ladderPayload(rows)
    });
    busy = false;
    if (error) {
      console.error('Error saving grade ladder:', error);
      toaster.error({ title: errorMessage(error) });
      return;
    }
    invalidateGradeDefinitions();
    toaster.success({ title: $_('page.gradeLadders.toast.saved') });
    await invalidate('app:grade-ladders');
  }
</script>

<div class="page-header-back">
  <a
    href="/dashboard/settings"
    class="btn preset-tonal-surface flex-shrink-0"
    title={$_('page.gradeLadders.back')}
    aria-label={$_('page.gradeLadders.back')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1 class="flex-1 min-w-0 truncate">{$_('page.gradeLadders.title')}</h1>
</div>

<p class="text-sm text-surface-600-400 mb-4">{$_('page.gradeLadders.intro')}</p>

<!-- Sections -->
<div class="flex flex-wrap items-center gap-2 mb-4" role="tablist">
  {#each sections as s (s.section)}
    <button
      type="button"
      role="tab"
      aria-selected={s.section === section}
      class="btn btn-sm {s.section === section
        ? 'preset-filled-primary-500'
        : 'preset-tonal-surface'}"
      disabled={busy}
      onclick={() => (selected = s.section)}
    >
      <span>{s.section}</span>
      <span class="text-xs opacity-75">
        {s.grades > 0
          ? $_('page.gradeLadders.gradeCount', { values: { count: s.grades } })
          : $_('page.gradeLadders.noLadderShort')}
      </span>
    </button>
  {/each}
  <form
    class="flex items-center gap-1"
    onsubmit={(e) => {
      e.preventDefault();
      addSection();
    }}
  >
    <input
      class="input input-sm w-40"
      type="text"
      maxlength="60"
      placeholder={$_('page.gradeLadders.newSection')}
      aria-label={$_('page.gradeLadders.newSection')}
      bind:value={newSection}
      disabled={busy}
    />
    <button
      type="submit"
      class="btn btn-sm preset-tonal-surface"
      disabled={busy || !newSection.trim()}
      title={$_('page.gradeLadders.addSection')}
      aria-label={$_('page.gradeLadders.addSection')}
    >
      <Fa icon={faPlus} />
    </button>
  </form>
</div>

{#if section}
  {@const info = sections.find((s) => s.section === section)}
  {#if info && !clubConfig.sections.includes(section)}
    <p class="text-sm p-3 rounded-lg preset-tonal-warning mb-3">
      {$_('page.gradeLadders.notClubSection', { values: { section } })}
    </p>
  {/if}

  {#if rows.length === 0}
    <div class="card p-4 bg-surface-50-950 border border-surface-300-700 flex flex-col gap-3">
      <p class="text-sm">{$_('page.gradeLadders.empty', { values: { section } })}</p>
      <div class="flex flex-wrap items-end gap-2">
        <label class="label w-24">
          <span class="text-xs">{$_('page.gradeLadders.template.kyu')}</span>
          <input class="input" type="number" min="0" max="12" bind:value={templateKyu} />
        </label>
        <label class="label w-24">
          <span class="text-xs">{$_('page.gradeLadders.template.dan')}</span>
          <input class="input" type="number" min="0" max="12" bind:value={templateDan} />
        </label>
        <button
          type="button"
          class="btn preset-tonal-primary"
          disabled={templateKyu + templateDan < 1 || templateKyu > 12 || templateDan > 12}
          onclick={startFromTemplate}
        >
          {$_('page.gradeLadders.template.use')}
        </button>
      </div>
      {#if otherLadders.length > 0}
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm">{$_('page.gradeLadders.copyFrom')}</span>
          {#each otherLadders as other (other.section)}
            <button
              type="button"
              class="btn btn-sm preset-tonal-surface"
              onclick={() => startFromLadder(other.section)}
            >
              {other.section}
            </button>
          {/each}
        </div>
      {/if}
      <div>
        <button type="button" class="btn btn-sm preset-tonal-surface" onclick={addRow}>
          <Fa icon={faPlus} />
          <span>{$_('page.gradeLadders.startEmpty')}</span>
        </button>
      </div>
    </div>
  {:else}
    <p class="text-xs text-surface-600-400 mb-2">{$_('page.gradeLadders.orderHint')}</p>
    <ol class="card border border-surface-200-800 divide-y divide-surface-200-800">
      {#each rows as row, i (row.key)}
        {@const used = uses(row)}
        <li class="flex flex-wrap items-center gap-2 px-3 py-2">
          <span class="w-6 text-right text-xs text-surface-600-400 tabular-nums">{i + 1}</span>
          <BeltStrip
            color={row.beltColor}
            color2={row.beltColor2}
            isDan={row.isDan}
            grade={row.grade}
            size="md"
          />
          <input
            class="input flex-1 min-w-36 sm:max-w-64"
            type="text"
            maxlength={MAX_GRADE_NAME}
            placeholder={$_('page.gradeLadders.gradePlaceholder')}
            aria-label={$_('page.gradeLadders.grade')}
            value={row.grade}
            oninput={(e) => update(i, { grade: e.currentTarget.value })}
            disabled={busy}
          />
          <label class="flex items-center gap-1 text-xs" title={$_('page.gradeLadders.color')}>
            <input
              type="color"
              class="h-8 w-10 cursor-pointer rounded border border-surface-300-700"
              aria-label={$_('page.gradeLadders.color')}
              value={toHexColor(row.beltColor)}
              oninput={(e) => update(i, { beltColor: e.currentTarget.value })}
              disabled={busy}
            />
          </label>
          <label class="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              class="checkbox"
              checked={row.beltColor2 !== null}
              onchange={(e) =>
                update(i, {
                  beltColor2: e.currentTarget.checked ? toHexColor(row.beltColor) : null
                })}
              disabled={busy}
            />
            <span>{$_('page.gradeLadders.twoColors')}</span>
          </label>
          <!-- Same width with or without a second colour, so the rows line up -->
          <span class="w-10 flex-none">
            {#if row.beltColor2 !== null}
              <input
                type="color"
                class="h-8 w-10 cursor-pointer rounded border border-surface-300-700"
                aria-label={$_('page.gradeLadders.color2')}
                title={$_('page.gradeLadders.color2')}
                value={toHexColor(row.beltColor2)}
                oninput={(e) => update(i, { beltColor2: e.currentTarget.value })}
                disabled={busy}
              />
            {/if}
          </span>
          <label class="flex items-center gap-1 text-xs" title={$_('page.gradeLadders.danHint')}>
            <input
              type="checkbox"
              class="checkbox"
              checked={row.isDan}
              onchange={(e) => update(i, { isDan: e.currentTarget.checked })}
              disabled={busy}
            />
            <span>{$_('page.gradeLadders.dan')}</span>
          </label>
          <div class="flex items-center gap-1 ml-auto">
            <span class="w-28 text-right">
              {#if used > 0}
                <span
                  class="chip preset-tonal-surface text-xs"
                  title={$_('page.gradeLadders.inUseHint')}
                >
                  {$_('page.gradeLadders.inUse', { values: { count: used } })}
                </span>
              {/if}
            </span>
            <button
              type="button"
              class="btn-icon btn-icon-sm preset-tonal-surface"
              title={$_('page.gradeLadders.moveUp')}
              aria-label={$_('page.gradeLadders.moveUp')}
              disabled={busy || i === 0}
              onclick={() => move(i, -1)}
            >
              <Fa icon={faArrowUp} />
            </button>
            <button
              type="button"
              class="btn-icon btn-icon-sm preset-tonal-surface"
              title={$_('page.gradeLadders.moveDown')}
              aria-label={$_('page.gradeLadders.moveDown')}
              disabled={busy || i === rows.length - 1}
              onclick={() => move(i, 1)}
            >
              <Fa icon={faArrowDown} />
            </button>
            <button
              type="button"
              class="btn-icon btn-icon-sm preset-tonal-error"
              title={used > 0 ? $_('page.gradeLadders.inUseHint') : $_('page.gradeLadders.remove')}
              aria-label={$_('page.gradeLadders.remove')}
              disabled={busy || used > 0}
              onclick={() => removeRow(i)}
            >
              <Fa icon={faTrash} />
            </button>
          </div>
        </li>
      {/each}
    </ol>
    <div class="mt-2">
      <button
        type="button"
        class="btn btn-sm preset-tonal-surface"
        onclick={addRow}
        disabled={busy}
      >
        <Fa icon={faPlus} />
        <span>{$_('page.gradeLadders.addGrade')}</span>
      </button>
    </div>
  {/if}

  {#if problems.length > 0 && dirty}
    <ul class="text-sm text-error-600-400 mt-3 list-disc pl-5">
      {#each problems as p, i (i)}
        <li>{problemText(p)}</li>
      {/each}
    </ul>
  {/if}

  <div class="flex justify-end gap-2 mt-4">
    <button
      type="button"
      class="btn preset-tonal-surface"
      disabled={busy || !dirty}
      onclick={() => (rows = saved)}
    >
      {$_('page.gradeLadders.discard')}
    </button>
    <button
      type="button"
      class="btn preset-filled-primary-500"
      disabled={busy || !dirty || problems.length > 0}
      onclick={requestSave}
    >
      {$_('page.gradeLadders.save')}
    </button>
  </div>
{/if}

{#if confirmSave}
  <ConfirmDialog
    title={$_('dialog.confirm.title')}
    message={rows.length === 0
      ? $_('page.gradeLadders.confirmDeleteLadder', { values: { section } })
      : $_('page.gradeLadders.confirmRemove', { values: { grades: removed.join(', ') } })}
    confirmLabel={$_('page.gradeLadders.save')}
    {busy}
    oncancel={() => (confirmSave = false)}
    onconfirm={save}
  />
{/if}
