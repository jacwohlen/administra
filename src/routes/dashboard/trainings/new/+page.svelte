<script lang="ts">
  import { supabaseClient } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faSave, faArrowLeft } from '@fortawesome/free-solid-svg-icons';

  let title = $state('');
  let weekday = $state('');
  let dateFrom = $state('');
  let dateTo = $state('');
  let section = $state('');
  let loading = $state(false);
  let error = $state('');

  const sections = ['Judo', 'Aikido'];
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  async function createTraining() {
    if (!title || !weekday || !dateFrom || !section) {
      error = $_('page.trainings.validation.required_fields');
      return;
    }

    loading = true;
    error = '';

    try {
      const { error: insertError, data } = await supabaseClient
        .from('trainings')
        .insert({
          title,
          weekday,
          dateFrom,
          dateTo: dateTo || null,
          section
        })
        .select()
        .single();

      if (insertError) {
        error = insertError.message;
        return;
      }

      await goto(`/dashboard/trainings/${data.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error occurred';
    } finally {
      loading = false;
    }
  }
</script>

<div class="page-header-back">
  <a href="/dashboard/trainings" class="btn preset-tonal-surface">
    <Fa icon={faArrowLeft} />
  </a>
  <h1>{$_('page.trainings.create_training')}</h1>
</div>

<form
  onsubmit={(e: SubmitEvent) => {
    e.preventDefault();
    createTraining();
  }}
  class="space-y-6"
>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
    <!-- Title -->
    <div class="md:col-span-2">
      <label class="label" for="title">
        <span>{$_('page.trainings.form.title')} *</span>
      </label>
      <input
        id="title"
        type="text"
        class="input"
        bind:value={title}
        required
        placeholder={$_('page.trainings.form.title_placeholder')}
      />
    </div>

    <!-- Weekday -->
    <div>
      <label class="label" for="weekday">
        <span>{$_('page.trainings.form.weekday')} *</span>
      </label>
      <select id="weekday" class="select" bind:value={weekday} required>
        <option value="">{$_('page.trainings.form.select_weekday')}</option>
        {#each weekdays as w}
          <option value={w}>{$_('weekday.' + w)}</option>
        {/each}
      </select>
    </div>

    <!-- Section -->
    <div>
      <label class="label" for="section">
        <span>{$_('page.trainings.form.section')} *</span>
      </label>
      <select id="section" class="select" bind:value={section} required>
        <option value="">{$_('page.trainings.form.select_section')}</option>
        {#each sections as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </div>

    <!-- Time From -->
    <div>
      <label class="label" for="dateFrom">
        <span>{$_('page.trainings.form.time_from')} *</span>
      </label>
      <input id="dateFrom" type="time" class="input" bind:value={dateFrom} required />
    </div>

    <!-- Time To -->
    <div>
      <label class="label" for="dateTo">
        <span>{$_('page.trainings.form.time_to')}</span>
      </label>
      <input id="dateTo" type="time" class="input" bind:value={dateTo} />
    </div>
  </div>

  {#if error}
    <div class="flex items-center gap-4 p-4 rounded-lg preset-filled-error-500">
      <div class="flex-1">
        <p>{error}</p>
      </div>
    </div>
  {/if}

  <div class="flex justify-end gap-4">
    <a href="/dashboard/trainings" class="btn preset-tonal-surface">
      {$_('button.cancel')}
    </a>
    <button type="submit" class="btn preset-filled-primary-500" disabled={loading}>
      <Fa icon={faSave} />
      <span>{loading ? $_('button.creating') : $_('button.create')}</span>
    </button>
  </div>
</form>
