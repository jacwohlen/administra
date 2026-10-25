<script lang="ts">
  import { Toast } from '@skeletonlabs/skeleton-svelte';
  import { _ } from 'svelte-i18n';
  import { toaster } from '$lib/toast';

  // Skeleton v4 is headless: the group renders only this template, nothing by
  // itself (styles in app.css). The colour follows the toast type.
  const PRESETS: Record<string, string> = {
    success: 'preset-filled-success-500',
    error: 'preset-filled-error-500',
    warning: 'preset-filled-warning-500'
  };
</script>

<Toast.Group {toaster}>
  {#snippet children(toast)}
    <Toast
      {toast}
      class="card shadow-xl {PRESETS[toast.type ?? ''] ?? 'preset-filled-surface-950-50'}"
    >
      <Toast.Message>
        <Toast.Title>{toast.title}</Toast.Title>
        {#if toast.description}
          <Toast.Description>{toast.description}</Toast.Description>
        {/if}
      </Toast.Message>
      <Toast.CloseTrigger aria-label={$_('button.close')} />
    </Toast>
  {/snippet}
</Toast.Group>
