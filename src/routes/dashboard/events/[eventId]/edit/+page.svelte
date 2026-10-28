<script lang="ts">
  import type { PageData } from './$types';
  import { supabaseClient } from '$lib/supabase';
  import { goto, invalidateAll } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faSave, faArrowLeft, faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
  import { clubConfig } from '$lib/clubConfig';
  import { isManagedByProviderError, providerName } from '$lib/memberStatus';

  let { data }: { data: PageData } = $props();

  let title = data.event.title;
  let description = data.event.description || '';
  let date = data.event.date;
  let timeFrom = data.event.timeFrom || '';
  let timeTo = data.event.timeTo || '';
  let location = data.event.location || '';
  let section = data.event.section;
  let maxParticipants: number | undefined = data.event.maxParticipants || undefined;
  let registrationDeadline = data.event.registrationDeadline || '';
  let loading = $state(false);
  let error = $state('');

  // An event its provider maintains: what the provider owns or fills is
  // shown, not sent (the database would refuse a change)
  let locked = $derived(new Set<string>(data.lockedFields));
  let provider = $derived(data.eventLink ? providerName(data.eventLink.connection) : null);

  const sections = clubConfig.sections;

  async function updateEvent() {
    const missing = (field: string, value: unknown) => !locked.has(field) && !value;
    if (missing('title', title) || missing('date', date) || missing('section', section)) {
      error = $_('page.events.validation.required_fields');
      return;
    }

    loading = true;
    error = '';

    const fields: Record<string, unknown> = {
      title,
      description: description || null,
      date,
      timeFrom: timeFrom || null,
      timeTo: timeTo || null,
      location: location || null,
      section,
      maxParticipants: maxParticipants || null,
      registrationDeadline: registrationDeadline || null
    };

    try {
      const { error: updateError } = await supabaseClient
        .from('events')
        .update(Object.fromEntries(Object.entries(fields).filter(([field]) => !locked.has(field))))
        .eq('id', data.event.id);

      if (updateError) {
        console.error('Error updating event:', updateError);
        // Linked (or its policy changed) after this page loaded
        error = isManagedByProviderError(updateError)
          ? $_('page.events.managedBy', {
              values: { provider: providerName(data.eventLink?.connection ?? 'webling') }
            })
          : $_('page.events.updateError');
        return;
      }

      // Invalidate all data to ensure fresh data is loaded
      await invalidateAll();
      await goto(`/dashboard/events/${data.event.id}`);
    } catch (e) {
      console.error('Error updating event:', e);
      error = $_('page.events.updateError');
    } finally {
      loading = false;
    }
  }
</script>

<div class="page-header-back">
  <a
    href="/dashboard/events/{data.event.id}"
    class="btn preset-tonal-surface"
    title={$_('page.events.backToEvent')}
    aria-label={$_('page.events.backToEvent')}
  >
    <Fa icon={faArrowLeft} />
  </a>
  <h1>{$_('page.events.edit_event')}</h1>
</div>

{#if provider}
  <div
    class="mb-4 flex items-center gap-2 rounded-md border border-surface-300-700 bg-surface-100-900 px-3 py-2 text-sm"
  >
    <Fa icon={faArrowsRotate} class="text-surface-500 flex-shrink-0" />
    <span>{$_('page.events.lockedByProvider', { values: { provider } })}</span>
  </div>
{/if}

<form
  onsubmit={(e: SubmitEvent) => {
    e.preventDefault();
    updateEvent();
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
        disabled={locked.has('title')}
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
        disabled={locked.has('description')}
        placeholder={$_('page.events.form.description_placeholder')}
      />
    </div>

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

    <!-- Section -->
    <div>
      <label class="label" for="section">
        <span>{$_('page.events.form.section')} *</span>
      </label>
      <select
        id="section"
        class="select"
        bind:value={section}
        required
        disabled={locked.has('section')}
      >
        <option value="">{$_('page.events.form.select_section')}</option>
        {#each sections as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </div>

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

    <!-- Location -->
    <div class="md:col-span-2">
      <label class="label" for="location">
        <span>{$_('page.events.form.location')}</span>
      </label>
      <input
        id="location"
        type="text"
        class="input"
        bind:value={location}
        disabled={locked.has('location')}
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
        disabled={locked.has('maxParticipants')}
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
    <a href="/dashboard/events/{data.event.id}" class="btn preset-tonal-surface">
      {$_('button.cancel')}
    </a>
    <button type="submit" class="btn preset-filled-primary-500" disabled={loading}>
      <Fa icon={faSave} />
      <span>{loading ? $_('button.saving') : $_('button.save')}</span>
    </button>
  </div>
</form>
