<script lang="ts">
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import MemberLogs from './MemberLogs.svelte';
  import {
    faCamera,
    faEdit,
    faTrash,
    faUpload,
    faUserMinus
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import { blobToURL, fromBlob } from 'image-resize-compress';
  import dayjs, { type Dayjs } from 'dayjs';
  import { goto, invalidate } from '$app/navigation';
  import MemberForm from '../MemberForm.svelte';
  import { toaster } from '$lib/toast';

  let { data }: { data: PageData } = $props();
  let loadingImage = false;
  let isDeleting = false;
  let isEditing = false;
  let showEditFormDialog = $state(false);
  let showDeleteConfirm = $state(false);

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
    const url = await blobToURL(blob);

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
    const url = await blobToURL(blob);

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
    document.getElementById('selectFiles')?.click();
  }
  function takePhoto() {
    document.getElementById('takePhoto')?.click();
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

<div class="max-w-4xl mx-auto space-y-4">
  <div class="flex justify-between items-center mb-4">
    <h1>{data.firstname} {data.lastname}</h1>
    <div class="flex gap-2">
      <button class="btn btn-sm preset-filled-primary-500" onclick={showEditForm}>
        <Fa icon={faEdit} />
        <span>{$_('button.edit')}</span>
      </button>
      <button class="btn btn-sm preset-tonal-error" onclick={confirmDelete} disabled={isDeleting}>
        {#if isDeleting}
          <span class="animate-spin">...</span>
        {:else}
          <Fa icon={faUserMinus} />
          <span>{$_('button.delete')}</span>
        {/if}
      </button>
    </div>
  </div>

  {#if showEditFormDialog}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onclick={() => (showEditFormDialog = false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') showEditFormDialog = false;
      }}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="card p-4 sm:p-6 w-full max-w-lg shadow-2xl bg-surface-50-950"
        onclick={(e) => e.stopPropagation()}
      >
        <h3 class="font-semibold text-lg mb-4">{$_('dialog.editMember.title')}</h3>
        <MemberForm
          isEditing={true}
          isSubmitting={isEditing}
          id={data.id}
          firstname={data.firstname}
          lastname={data.lastname}
          birthday={data.birthday}
          mobile={data.mobile}
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
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onclick={() => handleDeleteResponse(false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') handleDeleteResponse(false);
      }}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="card p-4 sm:p-6 w-full max-w-sm shadow-2xl bg-surface-50-950"
        onclick={(e) => e.stopPropagation()}
      >
        <h3 class="font-semibold text-lg mb-2">{$_('page.members.deleteConfirmTitle')}</h3>
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

  <div class="card p-4">
    <!-- Avatar + Photo buttons -->
    <div class="flex flex-col items-center mb-6">
      <div class="relative">
        {#if data.img}
          <img
            src={data.img}
            alt="{data.firstname} {data.lastname}"
            class="size-20 rounded-full object-cover"
          />
        {:else}
          <div
            class="size-20 rounded-full bg-surface-100-900 flex items-center justify-center text-xl font-bold"
          >
            {data.lastname.charAt(0)}{data.firstname.charAt(0)}
          </div>
        {/if}
        {#if loadingImage}
          <div class="absolute inset-0 flex items-center justify-center rounded-full bg-black/30">
            <span class="animate-spin text-2xl text-white">...</span>
          </div>
        {/if}
      </div>
      <div class="flex gap-1 mt-3">
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
        <button
          class="btn btn-icon preset-tonal-surface min-w-[44px] min-h-[44px]"
          onclick={selectFiles}
          title="Upload"
        >
          <Fa icon={faUpload} />
        </button>
        <button
          class="btn btn-icon preset-tonal-surface min-w-[44px] min-h-[44px]"
          onclick={takePhoto}
          title="Photo"
        >
          <Fa icon={faCamera} />
        </button>
        <button
          class="btn btn-icon preset-tonal-error min-w-[44px] min-h-[44px]"
          onclick={resetImage}
          title="Remove"
        >
          <Fa icon={faTrash} />
        </button>
      </div>
    </div>

    <!-- Member details -->
    <div class="space-y-3">
      <div class="flex flex-col sm:flex-row border-b border-surface-300-700 pb-2">
        <span class="sm:w-32 font-semibold text-surface-600-400">{$_('page.members.id')}</span>
        <span>{data.id}</span>
      </div>
      <div class="flex flex-col sm:flex-row border-b border-surface-300-700 pb-2">
        <span class="sm:w-32 font-semibold text-surface-600-400">{$_('page.members.lastName')}</span
        >
        <span>{data.lastname}</span>
      </div>
      <div class="flex flex-col sm:flex-row border-b border-surface-300-700 pb-2">
        <span class="sm:w-32 font-semibold text-surface-600-400"
          >{$_('page.members.firstName')}</span
        >
        <span>{data.firstname}</span>
      </div>
      <div class="flex flex-col sm:flex-row border-b border-surface-300-700 pb-2">
        <span class="sm:w-32 font-semibold text-surface-600-400">{$_('page.members.birthday')}</span
        >
        <span>{data.birthday || '-'}</span>
      </div>
      <div class="flex flex-col sm:flex-row border-b border-surface-300-700 pb-2">
        <span class="sm:w-32 font-semibold text-surface-600-400">{$_('page.members.mobile')}</span>
        <span>{data.mobile || '-'}</span>
      </div>
      <div class="flex flex-col sm:flex-row pb-2">
        <span class="sm:w-32 font-semibold text-surface-600-400">{$_('page.members.labels')}</span>
        <div class="flex flex-wrap gap-1">
          {#if data.labels}
            {#each data.labels as l}
              <span class="chip preset-tonal-secondary">{l}</span>
            {/each}
          {:else}
            <span>-</span>
          {/if}
        </div>
      </div>
    </div>
  </div>
  <MemberLogs memberId={data.id} />
</div>
