<script lang="ts">
  import { _ } from 'svelte-i18n';

  /**
   * "Did you mean …?" under an e-mail field (`suggestEmail()` in
   * `#lib/emailAddress.ts`): the person takes the corrected address or keeps
   * their own.
   */
  let {
    suggestion,
    onaccept,
    onkeep
  }: { suggestion: string; onaccept: () => void; onkeep?: () => void } = $props();
</script>

<div class="rounded-lg preset-tonal-warning p-3 text-sm space-y-2" role="status">
  <p class="break-all">
    {$_('components.emailCheck.suggestion', { values: { email: suggestion } })}
  </p>
  <div class="flex flex-wrap gap-2">
    <button type="button" class="btn btn-sm preset-filled-primary-500" onclick={onaccept}>
      {$_('components.emailCheck.useSuggestion')}
    </button>
    {#if onkeep}
      <button type="button" class="btn btn-sm preset-tonal-surface" onclick={onkeep}>
        {$_('components.emailCheck.keep')}
      </button>
    {/if}
  </div>
</div>
