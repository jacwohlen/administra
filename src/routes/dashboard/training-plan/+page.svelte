<script lang="ts">
  import PillToggle from '$lib/components/PillToggle.svelte';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faArrowRight,
    faBan,
    faBookOpen,
    faCalendarDays,
    faCalendarPlus,
    faCheck,
    faGear,
    faPen,
    faPlus,
    faPrint,
    faRotate,
    faDoorClosed,
    faUmbrellaBeach,
    faUser,
    faUserSlash,
    faXmark
  } from '@fortawesome/free-solid-svg-icons';
  import { _, locale } from 'svelte-i18n';
  import dayjs from 'dayjs';
  import { goto, invalidate } from '$app/navigation';
  import {
    buildPlan,
    parseTrainingIds,
    pickedTrainings,
    planKey,
    planTopics,
    togglePicked,
    trainerCounts,
    type PlanEvent,
    type PlanRow
  } from '$lib/trainingPlanUtils';
  import type { TrainingPlanBreak } from '$lib/models';
  import { eventEnd, formatEventDates } from '$lib/eventUtils';
  import SessionDialog from './SessionDialog.svelte';
  import PlanGrid from './PlanGrid.svelte';
  import RotationDialog from './RotationDialog.svelte';
  import CalendarFeedDialog from './CalendarFeedDialog.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const today = dayjs().format('YYYY-MM-DD');

  let hidden = $state<number[]>([]);
  let onlyOpen = $state(false);
  let showPast = $state(false);
  let selected = $state<string[]>([]);
  let dialogRows = $state<PlanRow[] | null>(null);
  let rotationOpen = $state(false);
  let calendarOpen = $state(false);

  // The chosen view and trainings stay for the next visit (this browser only)
  function stored(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function store(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode: the choice is just not kept
    }
  }
  let view = $state<'list' | 'table'>(stored('trainingPlan.view') === 'table' ? 'table' : 'list');
  // The trainings of the table; before several could be picked, it kept one
  let gridIds = $state(
    parseTrainingIds(stored('trainingPlan.trainings') ?? stored('trainingPlan.training'))
  );

  function setView(v: 'list' | 'table') {
    view = v;
    selected = [];
    store('trainingPlan.view', v);
  }
  function toggleGridTraining(id: number) {
    const picked = gridTrainings.map((t) => t.id);
    gridIds = togglePicked(picked, id);
    store('trainingPlan.trainings', gridIds.join(','));
  }

  let rows = $derived(
    buildPlan(data.trainings, data.sessions, data.breaks, data.events, data.from, data.to)
  );
  let memberName = $derived(
    new Map(data.members.map((m) => [m.id, `${m.firstname} ${m.lastname}`] as const))
  );
  let topics = $derived(planTopics(data.sessions));
  let counts = $derived(
    [...trainerCounts(rows)]
      .map(([id, count]) => ({ id, count, name: memberName.get(id) ?? '?' }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  );
  let openCount = $derived(
    rows.filter((r) => r.date >= today && !r.cancelled && r.trainerId == null).length
  );

  type Item =
    | { kind: 'row'; date: string; row: PlanRow }
    | { kind: 'event'; date: string; event: PlanEvent }
    | { kind: 'break'; date: string; brk: TrainingPlanBreak };

  // Rows, events without a training that day, the start of each break and
  // of each multi-day event (from the first day shown: the list may start
  // inside it, e.g. on January 1), grouped by month
  let months = $derived.by(() => {
    const start = showPast || data.year !== dayjs().year() ? data.from : today;
    const shown = rows.filter(
      (r) =>
        r.date >= start &&
        !hidden.includes(r.training.id) &&
        (!onlyOpen || (!r.cancelled && r.trainerId == null))
    );
    const trainingDays = new Set(rows.map((r) => r.date));
    const items: Item[] = shown.map((row) => ({ kind: 'row', date: row.date, row }));
    if (!onlyOpen) {
      for (const event of data.events) {
        if (eventEnd(event) > event.date) {
          if (eventEnd(event) >= start) {
            items.push({ kind: 'event', date: event.date < start ? start : event.date, event });
          }
        } else if (event.date >= start && !trainingDays.has(event.date)) {
          items.push({ kind: 'event', date: event.date, event });
        }
      }
      for (const brk of data.breaks) {
        if (brk.date_to >= start) {
          items.push({
            kind: 'break',
            date: brk.date_from < start ? start : brk.date_from,
            brk
          });
        }
      }
    }
    const order = { break: 0, event: 1, row: 2 };
    items.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

    const groups: { month: string; items: Item[] }[] = [];
    for (const item of items) {
      const month = item.date.slice(0, 7);
      if (groups.at(-1)?.month !== month) groups.push({ month, items: [] });
      groups.at(-1)!.items.push(item);
    }
    return groups;
  });

  // The trainings of the table, their dates interleaved (Mo, Fr, Mo, Fr, …)
  let gridTrainings = $derived(pickedTrainings(gridIds, data.trainings));
  let gridRows = $derived.by(() => {
    const start = showPast || data.year !== dayjs().year() ? data.from : today;
    const ids = new Set(gridTrainings.map((t) => t.id));
    return rows.filter((r) => ids.has(r.training.id) && r.date >= start);
  });

  let selectedRows = $derived(rows.filter((r) => selected.includes(planKey(r))));

  function toggleTraining(id: number) {
    hidden = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
  }

  function toggleSelected(r: PlanRow) {
    const k = planKey(r);
    selected = selected.includes(k) ? selected.filter((s) => s !== k) : [...selected, k];
  }

  function changeYear(by: number) {
    selected = [];
    goto(`/dashboard/training-plan?year=${data.year + by}`, { noScroll: true });
  }

  // Reloads of the plan under way. Until they land, the table is read-only
  // and the rotation waits: both have the plan from before the last saves
  // and would overwrite them
  let reloads = $state(0);
  async function reload(saves?: Promise<unknown>) {
    reloads++;
    try {
      await saves;
      await invalidate('training-plan:year');
    } finally {
      reloads--;
    }
  }

  async function saved() {
    dialogRows = null;
    rotationOpen = false;
    selected = [];
    await reload();
  }

  function monthLabel(month: string) {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString($locale ?? 'de', {
      month: 'long',
      year: 'numeric'
    });
  }

  function range(brk: TrainingPlanBreak) {
    const a = dayjs(brk.date_from).format('DD.MM.');
    const b = dayjs(brk.date_to).format('DD.MM.YYYY');
    return brk.date_from === brk.date_to ? b : `${a} – ${b}`;
  }
</script>

<div class="page-header gap-2">
  <h1 class="whitespace-nowrap">
    {$_('page.trainingPlan.title')}
    <span class="hidden print:inline">{data.year}</span>
  </h1>
  <div class="flex items-center gap-1 flex-shrink-0 print:hidden">
    <button
      class="btn-icon preset-tonal-surface"
      onclick={() => changeYear(-1)}
      title={$_('page.trainingPlan.previousYear')}
      aria-label={$_('page.trainingPlan.previousYear')}
    >
      <Fa icon={faArrowLeft} />
    </button>
    <span class="font-semibold tabular-nums px-1">{data.year}</span>
    <button
      class="btn-icon preset-tonal-surface"
      onclick={() => changeYear(1)}
      title={$_('page.trainingPlan.nextYear')}
      aria-label={$_('page.trainingPlan.nextYear')}
    >
      <Fa icon={faArrowRight} />
    </button>
  </div>
</div>

<p class="text-sm text-surface-600-400 mb-4 print:hidden">{$_('page.trainingPlan.intro')}</p>

<div class="flex flex-wrap gap-2 mb-4 print:hidden">
  {#if data.canPlanTrainings}
    <button
      class="btn preset-filled-primary-500"
      onclick={() => (rotationOpen = true)}
      disabled={data.trainings.length === 0}
    >
      <Fa icon={faRotate} />
      <span>{$_('page.trainingPlan.rotation.button')}</span>
    </button>
    <a href="/dashboard/training-plan/settings" class="btn preset-tonal-surface">
      <Fa icon={faGear} />
      <span>{$_('page.trainingPlan.settings.button')}</span>
    </a>
  {/if}
  <button
    class="btn preset-tonal-surface"
    onclick={() => window.print()}
    title={$_('page.trainingPlan.print')}
    aria-label={$_('page.trainingPlan.print')}
  >
    <Fa icon={faPrint} />
    <span class="hidden sm:inline">{$_('page.trainingPlan.print')}</span>
  </button>
  <button
    class="btn preset-tonal-surface"
    onclick={() => (calendarOpen = true)}
    title={$_('page.trainingPlan.calendar.button')}
    aria-label={$_('page.trainingPlan.calendar.button')}
  >
    <Fa icon={faCalendarPlus} />
    <span class="hidden sm:inline">{$_('page.trainingPlan.calendar.button')}</span>
  </button>
</div>

<!-- Filter chips: on/off toggles (several), also the trainings of the table -->
{#snippet toggleChip(
  on: boolean,
  label: string,
  onclick: () => void,
  onClass = 'preset-tonal-primary'
)}
  <button
    class="chip min-h-9 {on ? onClass : 'bg-surface-100-900 text-surface-600-400'}"
    {onclick}
    aria-pressed={on}
  >
    <Fa icon={on ? faCheck : faPlus} size="xs" class={on ? '' : 'opacity-60'} />
    <span>{label}</span>
  </button>
{/snippet}

{#if data.trainings.length === 0}
  <div class="empty-state">
    <p>{$_('page.trainingPlan.empty')}</p>
    {#if data.canPlanTrainings}
      <a href="/dashboard/training-plan/settings" class="btn preset-tonal-primary mt-3">
        <Fa icon={faGear} />
        <span>{$_('page.trainingPlan.settings.button')}</span>
      </a>
    {/if}
  </div>
{:else}
  <!-- View: overview of all trainings, or the picked trainings as a table to fill in quickly -->
  <div class="mb-3 print:hidden">
    <PillToggle
      name="plan-view"
      label={$_('page.trainingPlan.title')}
      value={view}
      options={(['list', 'table'] as const).map((v) => ({
        value: v,
        label: $_('page.trainingPlan.view.' + v)
      }))}
      onchange={(v) => setView(v as typeof view)}
    />
  </div>

  {#if view === 'table'}
    {#if data.trainings.length > 1}
      <p class="text-xs text-surface-600-400 mb-2 print:hidden">
        {$_('page.trainingPlan.grid.pickSeveral')}
      </p>
    {/if}
    <div class="flex flex-wrap gap-2 mb-4 print:hidden">
      {#each data.trainings as t (t.id)}
        {@render toggleChip(
          gridTrainings.some((g) => g.id === t.id),
          `${$_('weekdayShort.' + t.weekday)} · ${t.title}`,
          () => toggleGridTraining(t.id),
          'preset-filled-primary-500'
        )}
      {/each}
      {#if data.year === dayjs().year()}
        {@render toggleChip(
          showPast,
          $_('page.trainingPlan.showPast'),
          () => (showPast = !showPast)
        )}
      {/if}
    </div>
    {#if gridTrainings.length > 0}
      <!-- Picking trainings only changes the rows. A new table per year, and
           while the rotation is open: the old one saves what is pending and
           the plan is reloaded, so the rotation and the next table see it -->
      {#key `${data.year}|${rotationOpen}`}
        <PlanGrid
          rows={gridRows}
          members={data.members}
          {topics}
          canEdit={data.canPlanTrainings}
          waiting={reloads > 0}
          onchanged={reload}
        />
      {/key}
    {/if}
  {:else}
    <!-- Filters -->
    <div class="flex flex-wrap gap-2 mb-4 print:hidden">
      {#each data.trainings as t (t.id)}
        {@render toggleChip(
          !hidden.includes(t.id),
          `${$_('weekdayShort.' + t.weekday)} · ${t.title}`,
          () => toggleTraining(t.id)
        )}
      {/each}
      <button
        class="chip min-h-9 {onlyOpen
          ? 'preset-filled-warning-500'
          : 'bg-surface-100-900 text-surface-600-400'}"
        onclick={() => (onlyOpen = !onlyOpen)}
        aria-pressed={onlyOpen}
      >
        <Fa icon={faUserSlash} size="xs" />
        <span>{$_('page.trainingPlan.onlyOpen', { values: { count: openCount } })}</span>
      </button>
      {#if data.year === dayjs().year()}
        {@render toggleChip(
          showPast,
          $_('page.trainingPlan.showPast'),
          () => (showPast = !showPast)
        )}
      {/if}
    </div>

    {#if counts.length > 0}
      <details class="card border border-surface-200-800 mb-6 print:hidden">
        <summary class="cursor-pointer px-3 py-2.5 text-sm font-semibold">
          {$_('page.trainingPlan.trainerCounts')}
        </summary>
        <div class="flex flex-wrap gap-2 px-3 pb-3">
          {#each counts as c (c.id)}
            <span class="chip bg-surface-100-900 text-surface-900-50">
              {c.name} <span class="font-bold tabular-nums">{c.count}</span>
            </span>
          {/each}
        </div>
      </details>
    {/if}

    {#if months.length === 0}
      <div class="empty-state"><p>{$_('page.trainingPlan.nothingShown')}</p></div>
    {/if}

    <div class="space-y-4 {selected.length > 0 ? 'pb-20' : ''}">
      {#each months as group (group.month)}
        <section class="break-inside-avoid-page">
          <h3 class="mb-1.5!">{monthLabel(group.month)}</h3>
          <ul
            class="card border border-surface-200-800 divide-y divide-surface-200-800 overflow-hidden"
          >
            {#each group.items as item (item.kind + item.date + (item.kind === 'row' ? planKey(item.row) : item.kind === 'event' ? item.event.id : item.brk.id))}
              {#if item.kind === 'break'}
                <li
                  class="flex items-center gap-3 px-3 py-2 text-sm {item.brk.cancels_training
                    ? 'preset-tonal-warning'
                    : 'bg-surface-100-900 text-surface-700-300'}"
                >
                  {#if data.canPlanTrainings}
                    <span class="w-5 flex-none print:hidden"></span>
                  {/if}
                  <span class="w-12 flex-none text-center">
                    <Fa icon={item.brk.cancels_training ? faDoorClosed : faUmbrellaBeach} />
                  </span>
                  <span class="flex-1 min-w-0">
                    <span class="font-semibold">{item.brk.title}</span>
                    <span class="whitespace-nowrap">{range(item.brk)}</span>
                    <span class="block text-xs opacity-80">
                      {item.brk.cancels_training
                        ? $_('page.trainingPlan.breakClosed')
                        : $_('page.trainingPlan.breakOpen')}
                    </span>
                  </span>
                </li>
              {:else if item.kind === 'event'}
                <li class="flex items-center gap-3 px-3 py-2 text-sm preset-tonal-secondary">
                  {#if data.canPlanTrainings}
                    <span class="w-5 flex-none print:hidden"></span>
                  {/if}
                  <span class="w-12 flex-none text-center font-semibold tabular-nums">
                    {dayjs(item.date).format('DD.MM.')}
                  </span>
                  <a
                    href="/dashboard/events/{item.event.id}"
                    class="meta-item flex-1 min-w-0 hover:underline"
                  >
                    <Fa icon={faCalendarDays} size="sm" class="flex-none" />
                    <span class="truncate">{item.event.title}</span>
                    {#if eventEnd(item.event) > item.event.date}
                      <span class="whitespace-nowrap">{formatEventDates(item.event)}</span>
                    {/if}
                  </a>
                </li>
              {:else}
                {@const r = item.row}
                {@const trainer = r.trainerId}
                <li
                  class="flex items-center gap-3 px-3 py-2.5 {r.date === today
                    ? 'bg-primary-500/10'
                    : ''}"
                >
                  {#if data.canPlanTrainings}
                    <!-- 44 px tap area around the box; the negative margin keeps the row as it was -->
                    <label class="flex flex-none -m-3 p-3 cursor-pointer print:hidden">
                      <input
                        type="checkbox"
                        class="checkbox size-5"
                        checked={selected.includes(planKey(r))}
                        onchange={() => toggleSelected(r)}
                        aria-label={$_('page.trainingPlan.select')}
                      />
                    </label>
                  {/if}
                  <div
                    class="w-12 flex-none text-center leading-tight {r.cancelled
                      ? 'opacity-60'
                      : ''}"
                  >
                    <div class="text-xs text-surface-600-400">
                      {$_('weekdayShort.' + r.training.weekday)}
                    </div>
                    <div class="font-bold tabular-nums {r.cancelled ? 'line-through' : ''}">
                      {dayjs(r.date).format('DD.MM.')}
                    </div>
                  </div>
                  <a href="/dashboard/trainings/{r.training.id}/{r.date}" class="list-item-content">
                    <div class="flex items-baseline gap-1.5 min-w-0 leading-tight">
                      <span
                        class="font-semibold truncate {r.cancelled
                          ? 'line-through text-surface-600-400'
                          : ''}">{r.training.title}</span
                      >
                      <span class="flex-none text-sm text-surface-600-400"
                        >{r.training.dateFrom}</span
                      >
                    </div>
                    {#if r.cancelled}
                      <div class="meta-item text-sm text-warning-700-300 mt-0.5">
                        <Fa icon={faBan} size="sm" class="flex-none" />
                        <span class="truncate">
                          {r.session?.cancelled
                            ? $_('page.trainingPlan.cancelled')
                            : $_('page.trainingPlan.cancelledBreak', {
                                values: { title: r.break?.title ?? '' }
                              })}
                          {#if r.session?.notes}· {r.session.notes}{/if}
                        </span>
                      </div>
                    {:else}
                      <div
                        class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-sm text-surface-600-400"
                      >
                        <span
                          class="meta-item min-w-0 {trainer == null
                            ? 'text-warning-700-300 font-semibold'
                            : 'text-surface-900-50'}"
                        >
                          <Fa icon={faUser} size="sm" class="flex-none" />
                          <span>
                            {trainer != null
                              ? (memberName.get(trainer) ?? '?')
                              : $_('page.trainingPlan.trainerOpen')}
                            {#if r.defaultTrainer}
                              <span class="text-xs font-normal text-surface-600-400"
                                >({$_('page.trainingPlan.mainTrainer')})</span
                              >
                            {/if}
                          </span>
                        </span>
                        {#if r.session?.topic}
                          <span class="meta-item min-w-0">
                            <Fa icon={faBookOpen} size="sm" class="flex-none" />
                            <span class="truncate">{r.session.topic}</span>
                          </span>
                        {/if}
                      </div>
                      {#if r.session?.notes}
                        <div class="text-xs text-surface-600-400 truncate italic">
                          {r.session.notes}
                        </div>
                      {/if}
                    {/if}
                    {#if r.events.length > 0}
                      <div class="flex flex-wrap gap-1 mt-1">
                        {#each r.events as e (e.id)}
                          <span class="chip preset-tonal-secondary text-xs px-1.5 py-0.5 gap-1">
                            <Fa icon={faCalendarDays} size="xs" />
                            {e.title}
                          </span>
                        {/each}
                      </div>
                    {/if}
                  </a>
                  {#if data.canPlanTrainings}
                    <button
                      class="btn preset-tonal-primary flex-none print:hidden"
                      onclick={() => (dialogRows = [r])}
                      title={$_('button.edit')}
                      aria-label="{$_('button.edit')}: {r.training.title} {r.date}"
                    >
                      <Fa icon={faPen} />
                      <span class="hidden sm:inline">{$_('button.edit')}</span>
                    </button>
                  {/if}
                </li>
              {/if}
            {/each}
          </ul>
        </section>
      {/each}
    </div>

    <!-- Selection bar, as on the exam day -->
    {#if data.canPlanTrainings && selected.length > 0}
      <div
        class="fixed bottom-0 inset-x-0 z-40 bg-surface-100-900 border-t border-surface-300-700 p-3 print:hidden"
      >
        <div class="max-w-4xl mx-auto flex items-center gap-2">
          <button
            class="btn-icon size-11 p-0 flex-none hover:bg-surface-200-800"
            title={$_('button.cancel')}
            aria-label={$_('button.cancel')}
            onclick={() => (selected = [])}
          >
            <Fa icon={faXmark} />
          </button>
          <span class="flex-1 min-w-0 truncate text-sm tabular-nums">
            {$_('page.trainingPlan.selectedCount', { values: { count: selected.length } })}
          </span>
          <button
            class="btn preset-filled-primary-500 flex-none"
            onclick={() => (dialogRows = selectedRows)}
          >
            <Fa icon={faPen} />
            <span>{$_('button.edit')}</span>
          </button>
        </div>
      </div>
    {/if}
  {/if}
{/if}

{#if dialogRows}
  <SessionDialog
    rows={dialogRows}
    members={data.members}
    {topics}
    onclose={() => (dialogRows = null)}
    onsaved={saved}
  />
{/if}

{#if rotationOpen}
  <RotationDialog
    trainings={data.trainings}
    {rows}
    members={data.members}
    {topics}
    from={data.from}
    to={data.to}
    waiting={reloads > 0}
    onclose={() => (rotationOpen = false)}
    onsaved={saved}
  />
{/if}

{#if calendarOpen}
  <CalendarFeedDialog onclose={() => (calendarOpen = false)} />
{/if}
