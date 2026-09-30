<script lang="ts">
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import MemberLogs from './MemberLogs.svelte';
  import MemberBadges from '$lib/components/MemberBadges.svelte';
  import MemberGrades from '$lib/components/MemberGrades.svelte';
  import MemberMedals from '$lib/components/MemberMedals.svelte';
  import MedalTally from '$lib/components/MedalTally.svelte';
  import BeltStrip from '$lib/components/BeltStrip.svelte';
  import ActivityOverview from '$lib/components/ActivityOverview.svelte';
  import { beltRingColor, highestGrade, medalTally } from '$lib/gradeUtils';
  import {
    faArrowLeft,
    faCakeCandles,
    faCamera,
    faEdit,
    faEllipsisVertical,
    faEnvelope,
    faPhone,
    faTrash,
    faUpload
  } from '@fortawesome/free-solid-svg-icons';
  import { calculateAge } from '$lib/utils';
  import { supabaseClient } from '$lib/supabase';
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import { fromBlob } from 'image-resize-compress';
  import { blobToDataUrl } from '$lib/imageUtils';
  import dayjs, { type Dayjs } from 'dayjs';
  import { goto, invalidate } from '$app/navigation';
  import MemberForm from '../MemberForm.svelte';
  import { toaster } from '$lib/toast';

  let { data }: { data: PageData } = $props();
  let loadingImage = $state(false);
  let isDeleting = $state(false);
  let isEditing = $state(false);
  let showEditFormDialog = $state(false);
  let showDeleteConfirm = $state(false);

  let topGrade = $derived(highestGrade(data.currentGrades));
  let ringColor = $derived(topGrade ? beltRingColor(topGrade.beltColor) : null);
  let tally = $derived(medalTally(data.medals));
  let gradeSections = $derived([...new Set(data.gradeDefinitions.map((d) => d.section))]);
  let age = $derived(calculateAge(data.birthday));
  let showPhotoMenu = $state(false);

  function refresh() {
    invalidate('app:member:' + data.id);
  }

  async function handlePhotoChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file: File = input.files[0];
      const newTimeStamp = dayjs();
      const oldTimeStamp = data.imgUploaded;
      loadingImage = true;
      const url = await uploadNewProfilePictureToStorage(newTimeStamp, file);
      await updateSupabaseMember(file, newTimeStamp);
      await removeOldProfilePictureFromStorage(oldTimeStamp);
      data.img = url;
      data.imgUploaded = newTimeStamp;
      loadingImage = false;
    }
  }

  async function updateSupabaseMember(file: File, timeStamp: Dayjs) {
    const quality = 80;
    const width = 128;
    const height = 'auto';
    const format = 'webp';
    const blob = await fromBlob(file, quality, width, height, format);
    const url = await blobToDataUrl(blob);

    const { error } = await supabaseClient
      .from('members')
      .update({ img: url, imgUploaded: timeStamp })
      .eq('id', data.id);

    if (error) {
      throw err(404, error);
    }
  }

  async function removeOldProfilePictureFromStorage(timestamp: string | Dayjs | undefined) {
    if (timestamp) {
      const oldFileName = data.id + '_' + timestamp.valueOf() + '.webp';
      const { error: deleteError } = await supabaseClient.storage
        .from('avatars')
        .remove([oldFileName]);

      if (deleteError) {
        throw err(404, deleteError);
      }
    }
  }

  async function uploadNewProfilePictureToStorage(timestamp: Dayjs, file: File) {
    const quality = 80;
    const width = 512;
    const height = 'auto';
    const format = 'webp';
    const newFileName = data.id + '_' + timestamp.valueOf() + '.webp';
    const blob = await fromBlob(file, quality, width, height, format);
    const url = await blobToDataUrl(blob);

    const { error: uploadError } = await supabaseClient.storage
      .from('avatars')
      .upload(newFileName, blob, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      throw err(404, uploadError);
    }

    return url;
  }

  async function resetImage() {
    loadingImage = true;
    const { error } = await supabaseClient
      .from('members')
      .update({ img: null, imgUploaded: null })
      .eq('id', data.id)
      .select();

    if (error) {
      throw err(404, error);
    }

    await removeOldProfilePictureFromStorage(data.imgUploaded);
    data.img = undefined;
    data.imgUploaded = undefined;
    loadingImage = false;
  }

  function selectFiles() {
    showPhotoMenu = false;
    document.getElementById('selectFiles')?.click();
  }
  function takePhoto() {
    showPhotoMenu = false;
    document.getElementById('takePhoto')?.click();
  }
  function removePhoto() {
    showPhotoMenu = false;
    resetImage();
  }

  // Delete sits behind the ⋮ menu, as on the training page
  let menuOpen = $state(false);
  let menuStyle = $state('');
  let menuBtnEl: HTMLButtonElement;

  function toggleMenu() {
    if (menuOpen) {
      menuOpen = false;
      return;
    }
    const rect = menuBtnEl.getBoundingClientRect();
    menuStyle = `position:fixed;top:${rect.bottom + 4}px;left:${rect.right - 192}px;z-index:9999;`;
    menuOpen = true;
  }

  function handleWindowClick(e: MouseEvent) {
    if (menuOpen && menuBtnEl && !menuBtnEl.contains(e.target as Node)) {
      menuOpen = false;
    }
  }

  function showEditForm() {
    showEditFormDialog = true;
  }

  async function handleEditResponse(
    result: {
      firstname: string;
      lastname: string;
      birthday?: string;
      mobile?: string;
      email?: string;
      notes?: string;
      labels?: string[];
    } | null
  ) {
    if (!result) return;

    isEditing = true;

    try {
      // Update the member in the database
      const { error } = await supabaseClient
        .from('members')
        .update({
          firstname: result.firstname,
          lastname: result.lastname,
          birthday: result.birthday,
          mobile: result.mobile,
          email: result.email || null,
          notes: result.notes || null,
          labels: result.labels
        })
        .eq('id', data.id);

      if (error) {
        throw error;
      }

      // Show success toast
      toaster.success({ title: $_('dialog.editMember.updateSuccess') });

      // Invalidate the data to refresh
      invalidate('app:member:' + data.id);
    } catch (error) {
      console.error('Error updating member:', error);
      toaster.error({ title: $_('dialog.editMember.updateError') });
    } finally {
      isEditing = false;
    }
  }

  function confirmDelete() {
    showDeleteConfirm = true;
  }

  async function handleDeleteResponse(confirmed: boolean) {
    showDeleteConfirm = false;
    if (!confirmed) return;

    isDeleting = true;

    try {
      // First remove profile picture from storage if it exists
      if (data.imgUploaded) {
        await removeOldProfilePictureFromStorage(data.imgUploaded);
      }

      // Delete the member from the database
      const { error } = await supabaseClient.from('members').delete().eq('id', data.id);

      if (error) {
        throw error;
      }

      // Show success toast
      toaster.success({ title: $_('page.members.deleteSuccess') });

      // Navigate back to members list
      goto('/dashboard/members');
    } catch (error) {
      console.error('Error deleting member:', error);
      toaster.error({ title: $_('page.members.deleteError') });
      isDeleting = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="space-y-4">
  <div class="page-header-back">
    <a
      href="/dashboard/members"
      class="btn preset-tonal-surface"
      title={$_('page.members.backToList')}
      aria-label={$_('page.members.backToList')}
    >
      <Fa icon={faArrowLeft} />
    </a>
    <span class="flex-1 min-w-0 truncate text-surface-600-400">{$_('page.members.title')}</span>
    <div class="flex gap-2 flex-shrink-0">
      <button
        class="btn preset-tonal-surface"
        onclick={showEditForm}
        title={$_('button.edit')}
        aria-label={$_('button.edit')}
      >
        <Fa icon={faEdit} />
      </button>
      <div class="relative">
        <button
          class="btn preset-tonal-surface"
          bind:this={menuBtnEl}
          onclick={toggleMenu}
          aria-label={$_('page.members.moreActions')}
          aria-expanded={menuOpen}
        >
          <Fa icon={faEllipsisVertical} />
        </button>
        {#if menuOpen}
          <nav
            class="card min-w-48 p-1 shadow-xl bg-surface-50-950 border border-surface-300-700"
            style={menuStyle}
          >
            <button
              class="btn w-full justify-start text-error-600-400"
              onclick={() => {
                menuOpen = false;
                confirmDelete();
              }}
              disabled={isDeleting}
            >
              <Fa icon={faTrash} />
              <span>{$_('button.delete')}</span>
            </button>
          </nav>
        {/if}
      </div>
    </div>
  </div>

  {#if showEditFormDialog}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="modal-overlay"
      onclick={() => (showEditFormDialog = false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') showEditFormDialog = false;
      }}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="card modal-dialog modal-dialog-lg" onclick={(e) => e.stopPropagation()}>
        <h3>{$_('dialog.editMember.title')}</h3>
        <MemberForm
          isEditing={true}
          isSubmitting={isEditing}
          id={data.id}
          firstname={data.firstname}
          lastname={data.lastname}
          birthday={data.birthday}
          mobile={data.mobile}
          email={data.email}
          notes={data.notes}
          labels={data.labels}
          onclose={() => (showEditFormDialog = false)}
          onsubmit={handleEditResponse}
        />
      </div>
    </div>
  {/if}

  {#if showDeleteConfirm}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="modal-overlay"
      onclick={() => handleDeleteResponse(false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') handleDeleteResponse(false);
      }}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
        <h3>{$_('page.members.deleteConfirmTitle')}</h3>
        <p class="mb-4">
          {$_('page.members.deleteConfirmMessage')}
          {data.firstname}
          {data.lastname}?
        </p>
        <div class="flex justify-end gap-2">
          <button class="btn preset-tonal-surface" onclick={() => handleDeleteResponse(false)}>
            {$_('button.cancel')}
          </button>
          <button class="btn preset-filled-error-500" onclick={() => handleDeleteResponse(true)}>
            {$_('button.delete')}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Profile hero -->
  <section class="card border border-surface-200-800 overflow-hidden">
    <div class="h-20 sm:h-24 bg-linear-to-r from-primary-500/30 to-tertiary-500/20"></div>
    <div class="px-4 pt-2 pb-4">
      <div class="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12 sm:-mt-14">
        <!-- Avatar -->
        <div class="relative self-center sm:self-auto flex-none">
          <div
            class="rounded-full"
            style:box-shadow={ringColor
              ? `0 0 0 3px var(--color-surface-50-950), 0 0 0 7px ${ringColor}`
              : '0 0 0 4px var(--color-surface-50-950)'}
            title={topGrade ? `${topGrade.grade} ${topGrade.section}` : undefined}
          >
            {#if data.img}
              <img
                src={data.img}
                alt="{data.firstname} {data.lastname}"
                class="size-24 sm:size-28 rounded-full object-cover"
              />
            {:else}
              <div
                class="size-24 sm:size-28 rounded-full bg-surface-200-800 flex items-center justify-center text-3xl font-bold"
              >
                {data.lastname.charAt(0)}{data.firstname.charAt(0)}
              </div>
            {/if}
            {#if loadingImage}
              <div
                class="absolute inset-0 flex items-center justify-center rounded-full bg-black/30"
              >
                <span class="animate-spin text-2xl text-white">...</span>
              </div>
            {/if}
          </div>
          <button
            type="button"
            class="absolute bottom-0 right-0 size-9 rounded-full preset-filled-surface-950-50 flex items-center justify-center shadow-lg ring-2 ring-surface-50-950"
            title={$_('page.members.photo.change')}
            aria-label={$_('page.members.photo.change')}
            aria-expanded={showPhotoMenu}
            onclick={() => (showPhotoMenu = !showPhotoMenu)}
          >
            <Fa icon={faCamera} size="sm" />
          </button>
          {#if showPhotoMenu}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="fixed inset-0 z-40"
              onclick={() => (showPhotoMenu = false)}
              onkeydown={(e) => {
                if (e.key === 'Escape') showPhotoMenu = false;
              }}
            ></div>
            <div
              class="absolute left-1/2 -translate-x-1/2 sm:left-0 sm:translate-x-0 top-full mt-2 z-50 card p-2 w-56 shadow-xl bg-surface-50-950 border border-surface-300-700 flex flex-col gap-1"
            >
              <button class="btn preset-tonal-surface justify-start" onclick={selectFiles}>
                <Fa icon={faUpload} />
                <span>{$_('page.members.photo.upload')}</span>
              </button>
              <button class="btn preset-tonal-surface justify-start" onclick={takePhoto}>
                <Fa icon={faCamera} />
                <span>{$_('page.members.photo.take')}</span>
              </button>
              {#if data.img}
                <button class="btn preset-tonal-error justify-start" onclick={removePhoto}>
                  <Fa icon={faTrash} />
                  <span>{$_('page.members.photo.remove')}</span>
                </button>
              {/if}
            </div>
          {/if}
          <input
            type="file"
            id="selectFiles"
            class="hidden"
            accept="image/*"
            onchange={handlePhotoChange}
          />
          <input
            type="file"
            id="takePhoto"
            class="hidden"
            accept="image/*"
            onchange={handlePhotoChange}
            capture="user"
          />
        </div>

        <!-- Name + actions -->
        <div
          class="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-end gap-3 text-center sm:text-left"
        >
          <div class="flex-1 min-w-0">
            <h1 class="truncate">{data.firstname} {data.lastname}</h1>
            <p class="text-sm text-surface-600-400 tabular-nums">
              #{data.id}{#if age !== null}
                &middot; {$_('page.members.age', { values: { age } })}{/if}
            </p>
          </div>
        </div>
      </div>

      {#if data.labels?.length}
        <div class="flex flex-wrap justify-center sm:justify-start gap-1 mt-3">
          {#each data.labels as l (l)}
            <span class="chip preset-tonal-secondary text-xs">{l}</span>
          {/each}
        </div>
      {/if}

      <div class="mt-4 pt-4 border-t border-surface-200-800">
        <ActivityOverview memberId={data.id} />
      </div>

      {#if data.currentGrades.length > 0 || tally.total > 0}
        <div
          class="flex flex-wrap items-center justify-center sm:justify-between gap-3 mt-4 pt-4 border-t border-surface-200-800"
        >
          {#if data.currentGrades.length > 0}
            <div class="flex flex-wrap justify-center gap-x-4 gap-y-1">
              {#each data.currentGrades as g (g.section)}
                <span class="inline-flex items-center gap-2 text-sm" title={g.grade}>
                  <BeltStrip color={g.beltColor} isDan={g.isDan} grade={g.grade} />
                  <span class="font-semibold">{g.grade}</span>
                  <span class="text-surface-600-400">{g.section}</span>
                </span>
              {/each}
            </div>
          {/if}
          {#if tally.total > 0}
            <MedalTally {tally} />
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <!-- Contact -->
  <section class="grid grid-cols-1 sm:grid-cols-3 gap-2">
    {#snippet contactTile(
      icon: typeof faPhone,
      label: string,
      value: string | undefined,
      href?: string
    )}
      <div class="card border border-surface-200-800 p-3 flex items-center gap-3 min-w-0">
        <div class="entity-badge text-primary-600-400"><Fa {icon} /></div>
        <div class="min-w-0">
          <div class="text-xs text-surface-600-400">{label}</div>
          {#if value && href}
            <a {href} class="anchor block truncate">{value}</a>
          {:else}
            <div class="truncate" class:text-surface-600-400={!value}>{value || '–'}</div>
          {/if}
        </div>
      </div>
    {/snippet}
    {@render contactTile(
      faPhone,
      $_('page.members.mobile'),
      data.mobile,
      data.mobile ? `tel:${data.mobile.replace(/\s+/g, '')}` : undefined
    )}
    {@render contactTile(
      faEnvelope,
      $_('page.members.email'),
      data.email,
      data.email ? `mailto:${data.email}` : undefined
    )}
    {@render contactTile(
      faCakeCandles,
      $_('page.members.birthday'),
      data.birthday ? dayjs(data.birthday).format('DD.MM.YYYY') : undefined
    )}
  </section>

  {#if data.notes}
    <section class="card border border-surface-200-800 p-4">
      <h3 class="text-sm! font-semibold text-surface-600-400 mb-1!">{$_('page.members.notes')}</h3>
      <p class="whitespace-pre-wrap">{data.notes}</p>
    </section>
  {/if}

  <!-- Achievements -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <section class="card border border-surface-200-800 p-4">
      <MemberGrades
        memberId={parseInt(data.id)}
        current={data.currentGrades}
        history={data.gradeHistory}
        definitions={data.gradeDefinitions}
        onchanged={refresh}
      />
    </section>
    <section class="card border border-surface-200-800 p-4">
      <MemberMedals
        memberId={parseInt(data.id)}
        medals={data.medals}
        events={data.pastEvents}
        sections={gradeSections}
        onchanged={refresh}
      />
    </section>
  </div>
  <section class="card border border-surface-200-800 p-4">
    <MemberBadges
      badges={data.badges}
      progress={data.badgeProgress}
      definitions={data.badgeDefinitions}
    />
  </section>

  <!-- Attendance -->
  <MemberLogs memberId={data.id} />
</div>
