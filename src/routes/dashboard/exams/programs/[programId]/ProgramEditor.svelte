<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faArrowDown,
    faArrowUp,
    faPlus,
    faSave,
    faSpinner,
    faTrash
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import {
    defaultMinPoints,
    newItemKey,
    newPartKey,
    partMaxPoints,
    programMaxPoints,
    programProblems
  } from '$lib/examUtils';
  import type { ExamPart, ExamProgram } from '$lib/models';

  let {
    program,
    oncancel,
    onsaved
  }: { program: ExamProgram; oncancel: () => void; onsaved: () => void } = $props();

  // A working copy; nothing is stored until "Save"
  // svelte-ignore state_referenced_locally
  let title = $state(program.title);
  // svelte-ignore state_referenced_locally
  let minPoints = $state(program.min_points);
  // svelte-ignore state_referenced_locally
  let parts = $state<ExamPart[]>($state.snapshot(program.parts));
  let saving = $state(false);

  let max = $derived(programMaxPoints(parts));
  let problems = $derived(programProblems(parts, minPoints ?? 0));

  function move<T>(list: T[], index: number, by: number): T[] {
    const target = index + by;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }

  function addPart() {
    const partTitle = $_('page.exams.programs.newPart');
    const key = newPartKey(partTitle, parts);
    parts.push({
      key,
      title: partTitle,
      items: [{ key: newItemKey({ key }, parts), name: '', sides: 1 }]
    });
  }

  function addItem(part: ExamPart) {
    part.items.push({ key: newItemKey(part, parts), name: '', sides: 1 });
  }

  function setPartMin(part: ExamPart, value: string) {
    const n = parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) part.minPoints = n;
    else delete part.minPoints;
  }

  async function save() {
    if (problems.length > 0) return;
    saving = true;
    const cleaned: ExamPart[] = parts.map((p) => ({
      key: p.key,
      title: p.title.trim(),
      ...(p.subtitle?.trim() ? { subtitle: p.subtitle.trim() } : {}),
      ...(p.minPoints ? { minPoints: p.minPoints } : {}),
      items: p.items.map((i) => ({
        key: i.key,
        name: i.name.trim(),
        sides: i.sides,
        ...(i.description?.trim() ? { description: i.description.trim() } : {})
      }))
    }));
    const { error } = await supabaseClient
      .from('exam_programs')
      .update({
        title: title.trim() || program.grade,
        min_points: minPoints ?? 0,
        parts: cleaned,
        updated_at: new Date().toISOString()
      })
      .eq('id', program.id);
    saving = false;
    if (error) {
      console.error('Error saving program:', error);
      toaster.error({ title: $_('page.exams.programs.saveError') });
      return;
    }
    toaster.success({ title: $_('page.exams.programs.saved') });
    onsaved();
  }
</script>

<form
  class="space-y-4"
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
>
  <p class="text-sm text-surface-600-400">{$_('page.exams.programs.editHint')}</p>

  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <label class="label">
      <span>{$_('page.exams.programs.beltName')}</span>
      <input class="input" type="text" bind:value={title} />
    </label>
    <label class="label">
      <span>{$_('page.exams.programs.minPoints')}</span>
      <div class="flex gap-2">
        <input class="input" type="number" min="0" {max} bind:value={minPoints} />
        <button
          type="button"
          class="btn preset-tonal-surface whitespace-nowrap"
          onclick={() => (minPoints = defaultMinPoints(max))}
        >
          75 % = {defaultMinPoints(max)}
        </button>
      </div>
      <span class="text-xs text-surface-600-400">
        {$_('page.exams.programs.maxPoints', { values: { max } })}
      </span>
    </label>
  </div>

  {#each parts as part, pi (part.key)}
    <section class="card border border-surface-200-800 p-3 space-y-2">
      <div class="flex flex-wrap items-end gap-2">
        <label class="label flex-1 min-w-40">
          <span class="text-xs">{$_('page.exams.programs.partTitle')}</span>
          <input class="input" type="text" bind:value={part.title} />
        </label>
        <label class="label flex-1 min-w-40">
          <span class="text-xs">{$_('page.exams.programs.partSubtitle')}</span>
          <input class="input" type="text" bind:value={part.subtitle} />
        </label>
        <label class="label w-28">
          <span class="text-xs">{$_('page.exams.programs.partMin')}</span>
          <input
            class="input"
            type="number"
            min="0"
            max={partMaxPoints(part)}
            value={part.minPoints ?? ''}
            onchange={(e) => setPartMin(part, e.currentTarget.value)}
          />
        </label>
        <div class="flex gap-1">
          <button
            type="button"
            class="btn-icon preset-tonal-surface"
            title={$_('page.exams.programs.moveUp')}
            disabled={pi === 0}
            onclick={() => (parts = move(parts, pi, -1))}
          >
            <Fa icon={faArrowUp} />
          </button>
          <button
            type="button"
            class="btn-icon preset-tonal-surface"
            title={$_('page.exams.programs.moveDown')}
            disabled={pi === parts.length - 1}
            onclick={() => (parts = move(parts, pi, 1))}
          >
            <Fa icon={faArrowDown} />
          </button>
          <button
            type="button"
            class="btn-icon preset-tonal-error"
            title={$_('page.exams.programs.removePart')}
            onclick={() => (parts = parts.filter((p) => p !== part))}
          >
            <Fa icon={faTrash} />
          </button>
        </div>
      </div>
      <p class="text-xs text-surface-600-400">
        {$_('page.exams.programs.points', { values: { points: partMaxPoints(part) } })}
      </p>

      <ol class="space-y-2">
        {#each part.items as item, ii (item.key)}
          <li class="flex flex-wrap items-center gap-2 border-t border-surface-200-800 pt-2">
            <span class="w-5 text-xs text-surface-500 tabular-nums">{ii + 1}</span>
            <input
              class="input flex-1 min-w-40"
              type="text"
              placeholder={$_('page.exams.programs.itemName')}
              bind:value={item.name}
            />
            <input
              class="input flex-1 min-w-40"
              type="text"
              placeholder={$_('page.exams.programs.itemDescription')}
              bind:value={item.description}
            />
            <select class="select w-auto" bind:value={item.sides}>
              <option value={2}>{$_('page.exams.programs.bothSides')}</option>
              <option value={1}>{$_('page.exams.programs.oneSide')}</option>
            </select>
            <div class="flex gap-1">
              <button
                type="button"
                class="btn-icon btn-icon-sm preset-tonal-surface"
                title={$_('page.exams.programs.moveUp')}
                disabled={ii === 0}
                onclick={() => (part.items = move(part.items, ii, -1))}
              >
                <Fa icon={faArrowUp} size="xs" />
              </button>
              <button
                type="button"
                class="btn-icon btn-icon-sm preset-tonal-surface"
                title={$_('page.exams.programs.moveDown')}
                disabled={ii === part.items.length - 1}
                onclick={() => (part.items = move(part.items, ii, 1))}
              >
                <Fa icon={faArrowDown} size="xs" />
              </button>
              <button
                type="button"
                class="btn-icon btn-icon-sm preset-tonal-error"
                title={$_('button.remove')}
                onclick={() => (part.items = part.items.filter((i) => i !== item))}
              >
                <Fa icon={faTrash} size="xs" />
              </button>
            </div>
          </li>
        {/each}
      </ol>
      <button type="button" class="btn btn-sm preset-tonal-primary" onclick={() => addItem(part)}>
        <Fa icon={faPlus} />
        <span>{$_('page.exams.programs.addItem')}</span>
      </button>
    </section>
  {/each}

  <button type="button" class="btn preset-tonal-primary" onclick={addPart}>
    <Fa icon={faPlus} />
    <span>{$_('page.exams.programs.addPart')}</span>
  </button>

  {#if problems.length > 0}
    <ul class="text-sm text-error-600-400 list-disc pl-5">
      {#each problems as p (p)}
        <li>{$_('page.exams.programs.problems.' + p)}</li>
      {/each}
    </ul>
  {/if}

  <div class="flex justify-end gap-2 sticky bottom-0 bg-surface-50-950 py-2">
    <button type="button" class="btn preset-tonal-surface" onclick={oncancel}>
      {$_('button.cancel')}
    </button>
    <button
      type="submit"
      class="btn preset-filled-primary-500"
      disabled={saving || problems.length > 0}
    >
      <Fa icon={saving ? faSpinner : faSave} spin={saving} />
      <span>{$_('button.save')}</span>
    </button>
  </div>
</form>
