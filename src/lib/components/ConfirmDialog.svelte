<script lang="ts">
  import { _ } from 'svelte-i18n';
  import { modalDialog } from '$lib/modalDialog';

  /**
   * Confirmation before a destructive or irreversible action. Cancel is the
   * tonal button on the left, the action the red one on the right; Escape and
   * a click on the backdrop cancel.
   */
  let {
    title,
    message,
    confirmLabel = $_('button.confirm'),
    busy = false,
    onconfirm,
    oncancel
  }: {
    title: string;
    message: string;
    confirmLabel?: string;
    busy?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-overlay"
  onclick={(e) => {
    // Stop here so a dialog underneath stays open
    e.stopPropagation();
    oncancel();
  }}
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    oncancel();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div use:modalDialog class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
    <h3>{title}</h3>
    <p class="mb-4">{message}</p>
    <div class="flex justify-end gap-2">
      <button type="button" class="btn preset-tonal-surface" onclick={oncancel}>
        {$_('button.cancel')}
      </button>
      <button type="button" class="btn preset-filled-error-500" disabled={busy} onclick={onconfirm}>
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
