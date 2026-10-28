<script lang="ts">
  import { _ } from 'svelte-i18n';

  /**
   * Date, last day, all day and times of the event form (new and edit).
   * The last day is empty for a one-day event; all day hides the times,
   * which are then saved empty (eventDateValues). Locked fields (the edit
   * page of an event its provider maintains, lockedEventFields) are shown
   * disabled.
   */
  let {
    date = $bindable(),
    dateTo = $bindable(),
    allDay = $bindable(),
    timeFrom = $bindable(),
    timeTo = $bindable(),
    locked = new Set<string>()
  }: {
    date: string;
    dateTo: string;
    allDay: boolean;
    timeFrom: string;
    timeTo: string;
    locked?: ReadonlySet<string>;
  } = $props();
</script>

<!-- Date -->
<div>
  <label class="label" for="date">
    <span>{$_('page.events.form.date')} *</span>
  </label>
  <input
    id="date"
    type="date"
    class="input"
    bind:value={date}
    required
    disabled={locked.has('date')}
  />
</div>

<!-- Last day of a multi-day event -->
<div>
  <label class="label" for="dateTo">
    <span>{$_('page.events.form.date_to')}</span>
  </label>
  <input
    id="dateTo"
    type="date"
    class="input"
    bind:value={dateTo}
    min={date || undefined}
    disabled={locked.has('date_to')}
    aria-describedby="dateToHint"
  />
  <p id="dateToHint" class="text-xs text-surface-600-400 mt-1">
    {$_('page.events.form.date_to_hint')}
  </p>
</div>

<!-- All day -->
<label
  class="flex items-center gap-2 min-h-11 md:col-span-2"
  class:cursor-pointer={!locked.has('all_day')}
>
  <input
    id="allDay"
    class="checkbox"
    type="checkbox"
    bind:checked={allDay}
    disabled={locked.has('all_day')}
  />
  <span>{$_('page.events.form.all_day')}</span>
</label>

{#if !allDay}
  <!-- Time From -->
  <div>
    <label class="label" for="timeFrom">
      <span>{$_('page.events.form.time_from')}</span>
    </label>
    <input
      id="timeFrom"
      type="time"
      class="input"
      bind:value={timeFrom}
      disabled={locked.has('timeFrom')}
    />
  </div>

  <!-- Time To -->
  <div>
    <label class="label" for="timeTo">
      <span>{$_('page.events.form.time_to')}</span>
    </label>
    <input
      id="timeTo"
      type="time"
      class="input"
      bind:value={timeTo}
      disabled={locked.has('timeTo')}
    />
  </div>
{/if}
