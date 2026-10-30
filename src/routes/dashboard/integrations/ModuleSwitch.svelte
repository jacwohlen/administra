<script lang="ts">
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faPowerOff } from '@fortawesome/free-solid-svg-icons';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import { modalDialog } from '$lib/modalDialog';
  import type { ConnectionStatus } from '$lib/integrations';

  /**
   * Switches a connection on or off (integration_set_enabled, admins). Off:
   * the sync skips it and the app hides what belongs to it; links, runs and
   * data stay. Switching off asks first.
   */
  let {
    connection,
    onchanged
  }: { connection: ConnectionStatus; onchanged: () => Promise<void> | void } = $props();

  let busy = $state(false);
  let confirming = $state(false);

  async function set(enabled: boolean) {
    confirming = false;
    busy = true;
    const { error } = await supabaseClient.rpc('integration_set_enabled', {
      p_connection: connection.id,
      p_enabled: enabled
    });
    busy = false;
    if (error) {
      toaster.error({ title: $_('page.integrations.switch.error'), description: error.message });
      return;
    }
    toaster.success({
      title: $_(enabled ? 'page.integrations.switch.on' : 'page.integrations.switch.off', {
        values: { provider: connection.display_name }
      })
    });
    await onchanged();
  }
</script>

<button
  type="button"
  class="btn btn-sm {connection.enabled ? 'preset-tonal-surface' : 'preset-filled-primary-500'}"
  disabled={busy}
  onclick={() => (connection.enabled ? (confirming = true) : set(true))}
>
  <Fa icon={faPowerOff} />
  <span>
    {connection.enabled
      ? $_('page.integrations.switch.turnOff')
      : $_('page.integrations.switch.turnOn')}
  </span>
</button>

{#if confirming}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (confirming = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') confirming = false;
    }}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div use:modalDialog class="card modal-dialog" onclick={(e) => e.stopPropagation()}>
      <h3>
        {$_('page.integrations.switch.confirmTitle', {
          values: { provider: connection.display_name }
        })}
      </h3>
      <p class="mb-4">
        {$_(
          `page.integrations.switch.confirm.${connection.provider === 'js' ? 'module' : 'sync'}`,
          {
            values: { provider: connection.display_name }
          }
        )}
      </p>
      <div class="flex justify-end gap-2">
        <button class="btn preset-tonal-surface" onclick={() => (confirming = false)}>
          {$_('button.cancel')}
        </button>
        <button class="btn preset-filled-error-500" onclick={() => set(false)}>
          {$_('page.integrations.switch.turnOff')}
        </button>
      </div>
    </div>
  </div>
{/if}
