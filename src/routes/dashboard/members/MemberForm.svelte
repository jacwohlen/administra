<script lang="ts">
  import { _ } from 'svelte-i18n';

  import Fa from 'svelte-fa';
  import { faSpinner, faXmark } from '@fortawesome/free-solid-svg-icons';

  let {
    lastname = '',
    firstname = '',
    birthday = '',
    mobile = '',
    email = '',
    licenseNumber = '',
    notes = '',
    labels = ['new'] as string[],
    isSubmitting = false,
    isEditing = false,
    id = '',
    managedBy = null,
    onclose,
    onsubmit
  }: {
    lastname?: string;
    firstname?: string;
    birthday?: string;
    mobile?: string;
    email?: string;
    licenseNumber?: string | null;
    notes?: string;
    labels?: string[];
    isSubmitting?: boolean;
    isEditing?: boolean;
    id?: string;
    /** Provider the member comes from (e.g. 'Webling'): its fields are read-only, notes stay editable */
    managedBy?: string | null;
    onclose?: () => void;
    onsubmit?: (data: {
      id: string;
      lastname: string;
      firstname: string;
      birthday: string;
      mobile: string;
      email: string;
      license_number: string;
      notes: string;
      labels: string[];
    }) => void;
  } = $props();

  let labelInput = $state('');

  let formData = $state({
    id,
    lastname,
    firstname,
    birthday,
    mobile,
    email,
    license_number: licenseNumber ?? '',
    notes,
    labels: labels || ['new']
  });

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

<form class="space-y-4">
  {#if managedBy}
    <p class="text-sm text-surface-600-400">
      {$_('dialog.editMember.managedHint', { values: { provider: managedBy } })}
    </p>
  {/if}
  <label class="label">
    <span>{$_('dialog.newMember.lastName')} *</span>
    <input
      class="input"
      bind:value={formData.lastname}
      type="text"
      placeholder={$_('dialog.newMember.lastNamePlaceholder')}
      required
      disabled={!!managedBy}
    />
  </label>
  <label class="label">
    <span>{$_('dialog.newMember.firstName')} *</span>
    <input
      class="input"
      bind:value={formData.firstname}
      type="text"
      placeholder={$_('dialog.newMember.firstNamePlaceholder')}
      required
      disabled={!!managedBy}
    />
  </label>
  <label class="label">
    <span>{$_('page.members.birthday')}</span>
    <input
      class="input"
      bind:value={formData.birthday}
      type="date"
      placeholder="YYYY-MM-DD"
      disabled={!!managedBy}
    />
  </label>
  <label class="label">
    <span>{$_('page.members.mobile')}</span>
    <input
      class="input"
      bind:value={formData.mobile}
      type="tel"
      placeholder="+41 79 123 45 67"
      disabled={!!managedBy}
    />
  </label>
  <label class="label">
    <span>{$_('page.members.email')}</span>
    <input
      class="input"
      bind:value={formData.email}
      type="email"
      placeholder="name@example.com"
      disabled={!!managedBy}
    />
  </label>
  <label class="label">
    <span>{$_('page.members.licenseNumber')}</span>
    <input
      class="input"
      bind:value={formData.license_number}
      type="text"
      inputmode="numeric"
      maxlength="40"
      placeholder={$_('page.members.licenseNumberPlaceholder')}
      disabled={!!managedBy}
    />
  </label>
  <label class="label">
    <span>{$_('page.members.notes')}</span>
    <textarea
      class="textarea"
      bind:value={formData.notes}
      rows="3"
      placeholder={$_('page.members.notesPlaceholder')}
    ></textarea>
  </label>
  <div class="label">
    <span>{$_('page.members.labels')}</span>
    <div class="flex flex-wrap gap-1 mb-2">
      {#each formData.labels as label (label)}
        {#if managedBy}
          <span class="chip preset-tonal-secondary">{label}</span>
        {:else}
          <button
            type="button"
            class="chip preset-tonal-secondary flex items-center gap-1"
            onclick={() => removeLabel(label)}
          >
            {label}
            <Fa icon={faXmark} size="xs" />
          </button>
        {/if}
      {/each}
    </div>
    <div class="flex gap-2" class:hidden={!!managedBy}>
      <input
        class="input flex-1"
        bind:value={labelInput}
        onkeydown={handleLabelKeydown}
        type="text"
        placeholder={$_('dialog.newMember.labelPlaceholder')}
      />
      <button type="button" class="btn preset-filled-primary-500" onclick={addLabel}>
        {$_('button.add')}
      </button>
    </div>
  </div>
</form>
<footer class="flex justify-end gap-2 mt-4">
  <button class="btn preset-tonal-surface" onclick={cancel}>{$_('button.cancel')}</button>
  <button
    class="btn preset-filled-primary-500"
    disabled={(!managedBy && (!formData.firstname || !formData.lastname)) || isSubmitting}
    onclick={onFormSubmit}
  >
    {#if isSubmitting}
      <Fa icon={faSpinner} spin />
    {:else}
      {isEditing ? $_('button.save') : $_('button.add')}
    {/if}
  </button>
</footer>
