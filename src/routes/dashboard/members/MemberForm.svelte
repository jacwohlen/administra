<script lang="ts">
  import { _ } from 'svelte-i18n';

  import Fa from 'svelte-fa';
  import { faSpinner, faXmark } from '@fortawesome/free-solid-svg-icons';

  let {
    lastname = '',
    firstname = '',
    birthday = '',
    mobile = '',
    labels = ['new'] as string[],
    isSubmitting = false,
    isEditing = false,
    id = '',
    onclose,
    onsubmit
  }: {
    lastname?: string;
    firstname?: string;
    birthday?: string;
    mobile?: string;
    labels?: string[];
    isSubmitting?: boolean;
    isEditing?: boolean;
    id?: string;
    onclose?: () => void;
    onsubmit?: (data: {
      id: string;
      lastname: string;
      firstname: string;
      birthday: string;
      mobile: string;
      labels: string[];
    }) => void;
  } = $props();

  let labelInput = '';

  let formData = {
    id,
    lastname,
    firstname,
    birthday,
    mobile,
    labels: labels || ['new']
  };

  function addLabel() {
    const value = labelInput.trim().toLowerCase();
    if (value && !formData.labels.includes(value)) {
      formData.labels = [...formData.labels, value];
    }
    labelInput = '';
  }

  function removeLabel(label: string) {
    formData.labels = formData.labels.filter((l) => l !== label);
  }

  function handleLabelKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addLabel();
    }
  }

  function cancel() {
    onclose?.();
  }

  function onFormSubmit(): void {
    onsubmit?.(formData);
    onclose?.();
  }
</script>

<h3>{isEditing ? $_('dialog.editMember.title') : $_('dialog.newMember.title')}</h3>
<form class="border border-surface-600-400 p-4 space-y-4 rounded-lg">
  <label class="label">
    <span>{$_('dialog.newMember.lastName')}</span>
    <input
      class="input"
      bind:value={formData.lastname}
      type="text"
      placeholder={$_('dialog.newMember.lastNamePlaceholder')}
      required
    />
  </label>
  <label class="label">
    <span>{$_('dialog.newMember.firstName')}</span>
    <input
      class="input"
      bind:value={formData.firstname}
      type="text"
      placeholder={$_('dialog.newMember.firstNamePlaceholder')}
      required
    />
  </label>
  <label class="label">
    <span>{$_('page.members.birthday')}</span>
    <input class="input" bind:value={formData.birthday} type="date" placeholder="YYYY-MM-DD" />
  </label>
  <label class="label">
    <span>{$_('page.members.mobile')}</span>
    <input class="input" bind:value={formData.mobile} type="tel" placeholder="+41 79 123 45 67" />
  </label>
  <div class="label">
    <span>{$_('page.members.labels')}</span>
    <div class="flex flex-wrap gap-1 mb-2">
      {#each formData.labels as label (label)}
        <button
          type="button"
          class="chip preset-tonal-secondary flex items-center gap-1"
          onclick={() => removeLabel(label)}
        >
          {label}
          <Fa icon={faXmark} size="xs" />
        </button>
      {/each}
    </div>
    <div class="input-group grid-cols-[1fr_auto]">
      <input
        class="input"
        bind:value={labelInput}
        onkeydown={handleLabelKeydown}
        type="text"
        placeholder={$_('dialog.newMember.labelPlaceholder')}
      />
      <button type="button" class="preset-tonal-primary" onclick={addLabel}>
        {$_('button.add')}
      </button>
    </div>
  </div>
</form>
<footer class="modal-footer flex justify-end space-x-2">
  <button class="btn preset-tonal-surface" onclick={cancel}>{$_('button.cancel')}</button>
  <button
    class="btn preset-filled-primary-500"
    disabled={!formData.firstname || !formData.lastname || isSubmitting}
    onclick={onFormSubmit}
  >
    {#if isSubmitting}
      <Fa icon={faSpinner} spin />
    {:else}
      {isEditing ? $_('button.save') : $_('button.add')}
    {/if}
  </button>
</footer>
