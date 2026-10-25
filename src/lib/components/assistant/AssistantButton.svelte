<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
  import { loadAssistantStatus } from '$lib/assistant/client';

  /**
   * Opens the Daten-Assistent. Renders nothing on a deployment without
   * PRIVATE_ANTHROPIC_API_KEY, so pages can place it unconditionally next
   * to their own (permission-gated) controls.
   */
  let {
    label,
    onclick,
    class: className = 'btn preset-tonal-primary'
  }: { label?: string; onclick: () => void; class?: string } = $props();

  let configured = $state(false);
  loadAssistantStatus().then((s) => (configured = s.configured));
</script>

{#if configured}
  <button type="button" class={className} {onclick}>
    <Fa icon={faWandMagicSparkles} />
    <span>{label ?? $_('assistant.button')}</span>
  </button>
{/if}
