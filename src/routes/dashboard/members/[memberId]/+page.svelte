<script lang="ts">
  import type { PageData } from './$types';
  import {
    Avatar,
    ProgressRadial,
    getModalStore,
    getToastStore,
    type ModalComponent
  } from '@skeletonlabs/skeleton';
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

  const modalStore = getModalStore();
  const toastStore = getToastStore();

  let { data }: { data: PageData } = $props();
  let loadingImage = false;
  let isDeleting = false;
  let isEditing = false;

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
    const modalComponent: ModalComponent = {
      ref: MemberForm,
      props: {
        isEditing: true,
        isSubmitting: isEditing,
        id: data.id,
        firstname: data.firstname,
        lastname: data.lastname,
        birthday: data.birthday,
        mobile: data.mobile,
        labels: data.labels
      }
    };

    const modal = {
      type: 'component',
      component: modalComponent,
      response: handleEditResponse
    };

    modalStore.trigger(modal);
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
      toastStore.trigger({
        message: $_('dialog.editMember.updateSuccess'),
        background: 'variant-filled-success',
        timeout: 4000,
        classes: 'border-l-4 border-green-500'
      });

      // Invalidate the data to refresh
      invalidate('app:member:' + data.id);
    } catch (error) {
      console.error('Error updating member:', error);
      toastStore.trigger({
        message: $_('dialog.editMember.updateError'),
        background: 'variant-filled-error',
        timeout: 6000,
        classes: 'border-l-4 border-red-500'
      });
    } finally {
      isEditing = false;
    }
  }

  function confirmDelete() {
    const modal = {
      type: 'confirm',
      title: $_('page.members.deleteConfirmTitle'),
      body: `${$_('page.members.deleteConfirmMessage')} ${data.firstname} ${data.lastname}?`,
      buttonTextConfirm: $_('button.delete'),
      buttonTextCancel: $_('button.cancel'),
      response: handleDeleteResponse
    };
    modalStore.trigger(modal);
  }

  async function handleDeleteResponse(confirmed: boolean) {
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
      toastStore.trigger({
        message: $_('page.members.deleteSuccess'),
        background: 'variant-filled-success',
        timeout: 4000,
        classes: 'border-l-4 border-green-500'
      });

      // Navigate back to members list
      goto('/dashboard/members');
    } catch (error) {
      console.error('Error deleting member:', error);
      toastStore.trigger({
        message: $_('page.members.deleteError'),
        background: 'variant-filled-error',
        timeout: 6000,
        classes: 'border-l-4 border-red-500'
      });
      isDeleting = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex justify-between items-center mb-4">
    <h2 class="h2">{data.firstname} {data.lastname}</h2>
    <div class="flex gap-2">
      <button class="btn btn-sm variant-filled-primary" onclick={showEditForm}>
        <Fa icon={faEdit} />
        <span>{$_('button.edit')}</span>
      </button>
      <button
        class="btn btn-sm variant-filled-secondary"
        onclick={confirmDelete}
        disabled={isDeleting}
      >
        {#if isDeleting}
          <ProgressRadial
            width="w-6"
            stroke={100}
            meter="stroke-surface-50"
            track="stroke-error-500"
          />
        {:else}
          <Fa icon={faUserMinus} />
          <span>{$_('button.delete')}</span>
        {/if}
      </button>
    </div>
  </div>

  <div class="card p-4">
    <div class="mb-4">
      <div class="relative w-56 mx-auto">
        {#if data.img}
          <Avatar class="mx-auto w-56" src={data.img} />
        {:else}
          <Avatar
            class="mx-auto w-56"
            initials={data.lastname.charAt(0) + data.firstname.charAt(0)}
          />
        {/if}
        {#if loadingImage}
          <div class="absolute inset-0">
            <ProgressRadial value={undefined} />
          </div>
        {/if}
      </div>
      <div class="flex flex-auto justify-center pt-2">
        <div class="btn-group variant-filled-secondary">
          <div>
            <input
              type="file"
              id="selectFiles"
              style="display: none;"
              accept="image/*"
              onchange={handlePhotoChange}
            />
            <button class="" onclick={selectFiles}><Fa icon={faUpload} /></button>
          </div>
          <div>
            <input
              type="file"
              id="takePhoto"
              style="display: none;"
              accept="image/*"
              onchange={handlePhotoChange}
              capture="user"
            />
            <button class="" onclick={takePhoto}><Fa icon={faCamera} /></button>
          </div>
          <div>
            <button class="" onclick={resetImage}><Fa icon={faTrash} /></button>
          </div>
        </div>
      </div>
    </div>
    <div class="table-container">
      <table class="table">
        <tbody>
          <tr>
            <td><b>{$_('page.members.id')}</b></td>
            <td>{data.id}</td>
          </tr>
          <tr>
            <td><b>{$_('page.members.lastName')}</b></td>
            <td>{data.lastname}</td>
          </tr>
          <tr>
            <td><b>{$_('page.members.firstName')}</b></td>
            <td>{data.firstname}</td>
          </tr>
          <tr>
            <td><b>{$_('page.members.birthday')}</b></td>
            <td>{data.birthday}</td>
          </tr>
          <tr>
            <td><b>{$_('page.members.mobile')}</b></td>
            <td>{data.mobile}</td>
          </tr>
          <tr>
            <td><b>{$_('page.members.labels')}</b></td>
            <td>
              {#if data.labels}
                {#each data.labels as l}
                  <span class="chip mr-2">{l}</span>
                {/each}
              {/if}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <MemberLogs memberId={data.id} />
</div>
