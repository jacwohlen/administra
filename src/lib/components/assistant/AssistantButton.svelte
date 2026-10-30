<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
  import { loadAssistantStatus } from '$lib/assistant/client';

  /**
   * Opens the Daten-Assistent. Renders nothing on a deployment without
   * PRIVATE_ANTHROPIC_API_KEY, so pages can place it unconditionally next
   * to their own (permission-gated) controls. Next to a create button use
   * CreateButton instead; `iconOnly` shows just the wand, with `label` as
   * tooltip, where there is no create button to attach it to.
   */
  let {
    label,
    onclick,
    iconOnly = false,
    class: className = iconOnly ? 'btn-icon preset-tonal-primary' : 'btn preset-tonal-primary'
  }: { label?: string; onclick: () => void; iconOnly?: boolean; class?: string } = $props();

  let configured = $state(false);
  loadAssistantStatus().then((s) => (configured = s.configured));
</script>

{#if configured}
  {#if iconOnly}
    <button
      type="button"
      class={className}
      aria-label={label ?? $_('assistant.button')}
      title={label ?? $_('assistant.button')}
      {onclick}
    >
      <Fa icon={faWandMagicSparkles} />
    </button>
  {:else}
    <button type="button" class={className} {onclick}>
      <Fa icon={faWandMagicSparkles} />
      <span>{label ?? $_('assistant.button')}</span>
    </button>
  {/if}
{/if}
