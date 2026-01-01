<script lang="ts">
  import { supabaseClient } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faSave, faArrowLeft } from '@fortawesome/free-solid-svg-icons';

  let title = '';
  let description = '';
  let date = '';
  let timeFrom = '';
  let timeTo = '';
  let location = '';
  let section = '';
  let maxParticipants: number | undefined = undefined;
  let registrationDeadline = '';
  let loading = false;
  let error = '';

  const sections = ['Judo', 'Aikido']; // Should match existing sections

  async function createEvent() {
    if (!title || !date || !section) {
      error = $_('page.events.validation.required_fields');
      return;
    }

    loading = true;
    error = '';

    try {
      const { error: insertError, data } = await supabaseClient
        .from('events')
        .insert({
          title,
          description: description || null,
          date,
          timeFrom: timeFrom || null,
          timeTo: timeTo || null,
          location: location || null,
          section,
          maxParticipants: maxParticipants || null,
          registrationDeadline: registrationDeadline || null
        })
        .select()
        .single();

      if (insertError) {
        error = insertError.message;
        return;
      }

      await goto(`/dashboard/events/${data.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error occurred';
    } finally {
      loading = false;
    }
  }
</script>

<div class="max-w-2xl mx-auto">
  <div class="flex items-center gap-4 mb-6">
    <a href="/dashboard/events" class="btn variant-ghost-surface">
      <Fa icon={faArrowLeft} />
    </a>
    <h1>{$_('page.events.create_event')}</h1>
  </div>

  <form on:submit|preventDefault={createEvent} class="space-y-6">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
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

      <!-- Date -->
      <div>
        <label class="label" for="date">
          <span>{$_('page.events.form.date')} *</span>
        </label>
        <input id="date" type="date" class="input" bind:value={date} required />
      </div>

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

      <!-- Time From -->
      <div>
        <label class="label" for="timeFrom">
          <span>{$_('page.events.form.time_from')}</span>
        </label>
        <input id="timeFrom" type="time" class="input" bind:value={timeFrom} />
      </div>

      <!-- Time To -->
      <div>
        <label class="label" for="timeTo">
          <span>{$_('page.events.form.time_to')}</span>
        </label>
        <input id="timeTo" type="time" class="input" bind:value={timeTo} />
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
      <div class="alert variant-filled-error">
        <div class="alert-message">
          <p>{error}</p>
        </div>
      </div>
    {/if}

    <div class="flex justify-end gap-4">
      <a href="/dashboard/events" class="btn variant-ghost-surface">
        {$_('button.cancel')}
      </a>
      <button type="submit" class="btn variant-filled-primary" disabled={loading}>
        <Fa icon={faSave} />
        <span>{loading ? $_('button.creating') : $_('button.create')}</span>
      </button>
    </div>
  </form>
</div>
