<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faPlus,
    faWandMagicSparkles,
    type IconDefinition
  } from '@fortawesome/free-solid-svg-icons';
  import { loadAssistantStatus } from '$lib/assistant/client';

  /**
   * A page's own create button with the Daten-Assistent attached as a
   * small wand segment on its right, so the assistant takes no extra room.
   * Without PRIVATE_ANTHROPIC_API_KEY (or with `assistant` false) it is just
   * the create button. `href` makes the create part a link, else `onclick`.
   */
  let {
    label,
    href,
    onclick,
    icon = faPlus,
    class: className = 'btn preset-filled-primary-500',
    disabled = false,
    assistantLabel,
    onassistant,
    assistant = true
  }: {
    label: string;
    href?: string;
    onclick?: () => void;
    icon?: IconDefinition;
    /** Button classes, shared by both segments */
    class?: string;
    disabled?: boolean;
    /** What the wand does, e.g. assistant.kinds.events.title (tooltip and screen readers) */
    assistantLabel: string;
    onassistant: () => void;
    /** False hides the wand, e.g. when the assistant cannot work here */
    assistant?: boolean;
  } = $props();

  let configured = $state(false);
  loadAssistantStatus().then((s) => (configured = s.configured));

  const joined = $derived(assistant && configured);
</script>

<div class="inline-flex items-stretch">
  {#if href && !disabled}
    <a {href} class="{className} {joined ? 'btn-joined-start' : ''}">
      <Fa {icon} />
      <span>{label}</span>
    </a>
  {:else}
    <button
      type="button"
      class="{className} {joined ? 'btn-joined-start' : ''}"
      {onclick}
      {disabled}
    >
      <Fa {icon} />
      <span>{label}</span>
    </button>
  {/if}
  {#if joined}
    <button
      type="button"
      class="{className} btn-joined-end"
      aria-label={assistantLabel}
      title={assistantLabel}
      onclick={onassistant}
    >
      <Fa icon={faWandMagicSparkles} />
    </button>
  {/if}
</div>
