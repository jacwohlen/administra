<script lang="ts">
  import { _ } from 'svelte-i18n';

  let {
    lastname = '',
    firstname = '',
    onclose,
    onsubmit
  }: {
    lastname?: string;
    firstname?: string;
    onclose?: () => void;
    onsubmit?: (data: { lastname: string; firstname: string }) => void;
  } = $props();

  let formData = {
    lastname: lastname,
    firstname: firstname
  };

  function cancel() {
    onclose?.();
  }

  function onFormSubmit(): void {
    onsubmit?.(formData);
    onclose?.();
  }
</script>

<form class="space-y-4">
  <label class="label">
    <span>{$_('dialog.newMember.lastName')}</span>
    <input
      class="input"
      bind:value={formData.lastname}
      type="text"
      placeholder={$_('dialog.newMember.lastNamePlaceholder')}
    />
  </label>
  <label class="label">
    <span>{$_('dialog.newMember.firstName')}</span>
    <input
      class="input"
      bind:value={formData.firstname}
      type="text"
      placeholder={$_('dialog.newMember.firstNamePlaceholder')}
    />
  </label>
</form>
<footer class="flex justify-end gap-2 mt-4">
  <button class="btn preset-tonal-surface" onclick={cancel}>{$_('button.cancel')}</button>
  <button class="btn preset-filled" onclick={onFormSubmit}>{$_('button.add')}</button>
</footer>
