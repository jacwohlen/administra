<script lang="ts">
  import { supabaseClient } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faSave, faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { clubConfig } from '$lib/clubConfig';
  import { eventDateValues, saveEventRow, type EventDateInput } from '$lib/eventUtils';
  import EventDateFields from '../EventDateFields.svelte';

  let title = '';
  let description = '';
  let dates = $state<EventDateInput>({
    date: '',
    dateTo: '',
    allDay: false,
    timeFrom: '',
    timeTo: ''
  });
  let location = '';
  let section = '';
  let maxParticipants: number | undefined = undefined;
  let registrationDeadline = '';
  let loading = $state(false);
  let error = $state('');

  const sections = clubConfig.sections;

  async function createEvent() {
    if (!title || !dates.date || !section) {
      error = $_('page.events.validation.required_fields');
      return;
    }
    const when = eventDateValues(dates);
    if (when === 'dateToBeforeDate') {
      error = $_('page.events.validation.date_to');
      return;
    }

    loading = true;
    error = '';

    try {
      const { error: insertError, data } = await saveEventRow(
        {
          title,
          description: description || null,
          ...when,
          location: location || null,
          section,
          maxParticipants: maxParticipants || null,
          registrationDeadline: registrationDeadline || null
        },
        (values) => supabaseClient.from('events').insert(values).select().single()
      );

      if (insertError) {
        console.error('Error creating event:', insertError);
        error = $_('page.events.createError');
        return;
      }

      await goto(`/dashboard/events/${data.id}`);
    } catch (e) {
      console.error('Error creating event:', e);
      error = $_('page.events.createError');
    } finally {
      loading = false;
    }
  }
</script>

<div class="page-header-back">
  <a
    href="/dashboard/events"
    class="btn preset-tonal-surface"
    title={$_('page.events.backToList')}
    aria-label={$_('page.events.backToList')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1>{$_('page.events.create_event')}</h1>
</div>

<form
  onsubmit={(e: SubmitEvent) => {
    e.preventDefault();
    createEvent();
  }}
  class="space-y-6"
>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
    <!-- Title -->
    <div class="md:col-span-2">
      <label class="label" for="title">
        <span>{$_('page.events.form.title')} *</span>
      </label>
      <input
        id="title"
        type="text"
        class="input"
        bind:value={title}
        required
        placeholder={$_('page.events.form.title_placeholder')}
      />
    </div>

    <!-- Description -->
    <div class="md:col-span-2">
      <label class="label" for="description">
        <span>{$_('page.events.form.description')}</span>
      </label>
      <textarea
        id="description"
        class="textarea"
        bind:value={description}
        rows="3"
        placeholder={$_('page.events.form.description_placeholder')}
      />
    </div>

    <EventDateFields
      bind:date={dates.date}
      bind:dateTo={dates.dateTo}
      bind:allDay={dates.allDay}
      bind:timeFrom={dates.timeFrom}
      bind:timeTo={dates.timeTo}
    />

    <!-- Section -->
    <div>
      <label class="label" for="section">
        <span>{$_('page.events.form.section')} *</span>
      </label>
      <select id="section" class="select" bind:value={section} required>
        <option value="">{$_('page.events.form.select_section')}</option>
        {#each sections as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </div>

    <!-- Location -->
    <div>
      <label class="label" for="location">
        <span>{$_('page.events.form.location')}</span>
      </label>
      <input
        id="location"
        type="text"
        class="input"
        bind:value={location}
        placeholder={$_('page.events.form.location_placeholder')}
      />
    </div>

    <!-- Max Participants -->
    <div>
      <label class="label" for="maxParticipants">
        <span>{$_('page.events.form.max_participants')}</span>
      </label>
      <input
        id="maxParticipants"
        type="number"
        class="input"
        bind:value={maxParticipants}
        min="1"
        placeholder={$_('page.events.form.max_participants_placeholder')}
      />
    </div>

    <!-- Registration Deadline -->
    <div>
      <label class="label" for="registrationDeadline">
        <span>{$_('page.events.form.registration_deadline')}</span>
      </label>
      <input
        id="registrationDeadline"
        type="date"
        class="input"
        bind:value={registrationDeadline}
      />
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
    <a href="/dashboard/events" class="btn preset-tonal-surface">
      {$_('button.cancel')}
    </a>
    <button type="submit" class="btn preset-filled-primary-500" disabled={loading}>
      <Fa icon={faSave} />
      <span>{loading ? $_('button.creating') : $_('button.create')}</span>
    </button>
  </div>
</form>
