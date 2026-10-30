<script lang="ts">
  import MoreMenu from '$lib/components/MoreMenu.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { modalDialog } from '$lib/modalDialog';
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import MemberProfile from '$lib/components/memberProfile/MemberProfile.svelte';
  import {
    faArrowLeft,
    faArrowsRotate,
    faBoxArchive,
    faCamera,
    faCodeMerge,
    faEdit,
    faTrash,
    faUpload
  } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { error as err } from '@sveltejs/kit';
  import Fa from 'svelte-fa';
  import { fromBlob } from 'image-resize-compress';
  import { blobToDataUrl } from '$lib/imageUtils';
  import dayjs, { type Dayjs } from 'dayjs';
  import { goto, invalidate } from '$app/navigation';
  import MemberForm from '../MemberForm.svelte';
  import MergeMemberDialog from './MergeMemberDialog.svelte';
  import { avatarPath } from '$lib/memberMerge';
  import { toaster } from '$lib/toast';
  import {
    isManagedByProviderError,
    providerName,
    statusChip,
    visibleLabels
  } from '$lib/memberStatus';

  let { data }: { data: PageData } = $props();
  let loadingImage = $state(false);
  let isDeleting = $state(false);
  let isEditing = $state(false);
  let showEditFormDialog = $state(false);
  let showDeleteConfirm = $state(false);
  let showMergeDialog = $state(false);
  // The profile loads attendance itself (MemberLogs, ActivityOverview), not
  // through this page's load: it is built anew for another member (goto
  // reuses this page, e.g. to the member a merge kept) and after a merge
  // into this one
  let mergeCount = $state(0);

  let memberId = $derived(Number(data.id));
  // Viewers get the profile read-only; the database enforces the same
  let canWrite = $derived(data.canWrite);
  let showPhotoMenu = $state(false);
  // Members from a provider (Webling) are edited there; only notes and photo here
  let provider = $derived(data.managedBy ? providerName(data.managedBy) : null);
  let status = $derived(statusChip(data.membership_status));
  let tags = $derived([
    ...(status ? [$_(`page.members.status.${status}`)] : []),
    ...visibleLabels(data.labels)
  ]);

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
    const blob = await fromBlob(file, { quality: 80, width: 128, format: 'webp' });
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
      const oldFileName = avatarPath(data.id, timestamp);
      const { error: deleteError } = await supabaseClient.storage
        .from('avatars')
        .remove([oldFileName]);

      if (deleteError) {
        throw err(404, deleteError);
      }
    }
  }

  async function uploadNewProfilePictureToStorage(timestamp: Dayjs, file: File) {
    const newFileName = avatarPath(data.id, timestamp);
    const blob = await fromBlob(file, { quality: 80, width: 512, format: 'webp' });
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
      license_number?: string;
      notes?: string;
      labels?: string[];
    } | null
  ) {
    if (!result) return;

    isEditing = true;

    try {
      // Update the member in the database; the database refuses changes to
      // the fields a provider owns (trigger_guard_provider_fields)
      const changes = provider
        ? { notes: result.notes || null }
        : {
            firstname: result.firstname,
            lastname: result.lastname,
            birthday: result.birthday,
            mobile: result.mobile,
            email: result.email || null,
            license_number: result.license_number?.trim() || null,
            notes: result.notes || null,
            labels: result.labels
          };
      const { error } = await supabaseClient.from('members').update(changes).eq('id', data.id);

      if (error) {
        throw error;
      }

      // Show success toast
      toaster.success({ title: $_('dialog.editMember.updateSuccess') });

      // Invalidate the data to refresh
      invalidate('app:member:' + data.id);
    } catch (error) {
      console.error('Error updating member:', error);
      toaster.error({
        title: isManagedByProviderError(error)
          ? $_('page.members.managedError', { values: { provider: provider ?? 'Webling' } })
          : $_('dialog.editMember.updateError')
      });
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
      // Delete the member from the database first: it may refuse (a member
      // still in Webling, attendance history), and the photo must survive that
      const { error } = await supabaseClient.from('members').delete().eq('id', data.id);

      if (error) {
        throw error;
      }

      // A leftover file is harmless, so this must not fail the delete
      if (data.imgUploaded) {
        await removeOldProfilePictureFromStorage(data.imgUploaded).catch((e) =>
          console.error('Error removing profile picture:', e)
        );
      }

      // Show success toast
      toaster.success({ title: $_('page.members.deleteSuccess') });

      // Navigate back to members list
      goto('/dashboard/members');
    } catch (error) {
      console.error('Error deleting member:', error);
      toaster.error({
        title: isManagedByProviderError(error)
          ? $_('page.members.managedError', { values: { provider: provider ?? 'Webling' } })
          : $_('page.members.deleteError')
      });
      isDeleting = false;
    }
  }
</script>

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
    {#if canWrite}
      <div class="flex gap-2 flex-shrink-0">
        <button
          class="btn preset-tonal-surface"
          onclick={showEditForm}
          title={$_('button.edit')}
          aria-label={$_('button.edit')}
        >
          <Fa icon={faEdit} />
        </button>
        <!-- A provider's members are not deleted here: they keep their history and leave in the provider.
             Admins merge duplicates, also into a provider's member. -->
        {#if !provider || data.isAdmin}
          <MoreMenu>
            {#snippet items(close)}
              {#if data.isAdmin}
                <button
                  class="btn w-full justify-start"
                  onclick={() => {
                    close();
                    showMergeDialog = true;
                  }}
                >
                  <Fa icon={faCodeMerge} />
                  <span>{$_('page.members.merge.action')}</span>
                </button>
              {/if}
              {#if !provider}
                <button
                  class="btn w-full justify-start text-error-600-400"
                  onclick={() => {
                    close();
                    confirmDelete();
                  }}
                  disabled={isDeleting}
                >
                  <Fa icon={faTrash} />
                  <span>{$_('button.delete')}</span>
                </button>
              {/if}
            {/snippet}
          </MoreMenu>
        {/if}
      </div>
    {/if}
  </div>

  {#if provider}
    <p
      class="flex items-center gap-2 rounded-md border border-surface-300-700 bg-surface-100-900 px-3 py-2 text-sm"
    >
      <Fa icon={faArrowsRotate} class="text-surface-500" />
      <span>{$_('page.members.managedBy', { values: { provider } })}</span>
    </p>
  {/if}

  {#if data.archivedAt}
    <p
      class="flex items-center gap-2 rounded-md border border-surface-300-700 bg-surface-100-900 px-3 py-2 text-sm"
    >
      <Fa icon={faBoxArchive} class="text-surface-500" />
      <span>
        {$_('page.members.archived', {
          values: { date: dayjs(data.archivedAt).format('DD.MM.YYYY') }
        })}
        <a href="/dashboard/probetraining" class="anchor">{$_('page.members.archivedLink')}</a>
      </span>
    </p>
  {/if}

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
      <div
        use:modalDialog
        class="card modal-dialog modal-dialog-lg"
        onclick={(e) => e.stopPropagation()}
      >
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
          licenseNumber={data.license_number}
          notes={data.notes}
          labels={data.labels}
          managedBy={provider}
          onclose={() => (showEditFormDialog = false)}
          onsubmit={handleEditResponse}
        />
      </div>
    </div>
  {/if}

  {#if showMergeDialog}
    <MergeMemberDialog
      first={{
        id: memberId,
        firstname: data.firstname,
        lastname: data.lastname,
        birthday: data.birthday,
        mobile: data.mobile,
        email: data.email,
        license_number: data.license_number ?? null,
        labels: data.labels,
        membership_status: data.membership_status,
        archivedAt: data.archivedAt,
        trialRegisteredAt: data.trialRegisteredAt
      }}
      onclose={() => (showMergeDialog = false)}
      onmerged={(keepId) => {
        showMergeDialog = false;
        invalidate('members:list');
        if (keepId === memberId) {
          mergeCount++;
          refresh();
        } else goto(`/dashboard/members/${keepId}`);
      }}
    />
  {/if}

  {#if showDeleteConfirm}
    <ConfirmDialog
      title={$_('page.members.deleteConfirmTitle')}
      message={`${$_('page.members.deleteConfirmMessage')} ${data.firstname} ${data.lastname}?`}
      confirmLabel={$_('button.delete')}
      oncancel={() => handleDeleteResponse(false)}
      onconfirm={() => handleDeleteResponse(true)}
    />
  {/if}

  {#key `${memberId}-${mergeCount}`}
    <MemberProfile
      id={memberId}
      firstname={data.firstname}
      lastname={data.lastname}
      photo={data.img ?? null}
      {tags}
      showId
      details={{ birthday: data.birthday, mobile: data.mobile, email: data.email }}
      notes={data.notes}
      showAttendance
      achievements={data}
      editing={canWrite ? { events: data.pastEvents, onchanged: refresh } : null}
    >
      {#snippet photoAction()}
        {#if canWrite}
          {#if loadingImage}
            <div class="absolute inset-0 flex items-center justify-center rounded-full bg-black/30">
              <span class="animate-spin text-2xl text-white">...</span>
            </div>
          {/if}
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
        {/if}
      {/snippet}
    </MemberProfile>
  {/key}
</div>
