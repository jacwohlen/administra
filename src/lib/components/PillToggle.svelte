<script lang="ts">
  import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';

  /**
   * Pill toggle for choosing one of 2–4 views of the same list (styled in
   * app.css as the radio-group). Use chips instead when there are more
   * options or their number depends on the data.
   */
  let {
    name,
    label,
    options,
    value,
    disabled = false,
    onchange
  }: {
    name: string;
    label: string;
    options: { value: string; label: string; count?: number }[];
    /** A value outside `options` leaves every pill unselected */
    value: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  } = $props();
</script>

<SegmentedControl
  {name}
  {value}
  {disabled}
  aria-label={label}
  onValueChange={(e) => {
    if (e.value) onchange(e.value);
  }}
>
  {#each options as o (o.value)}
    <SegmentedControl.Item value={o.value}>
      <SegmentedControl.ItemHiddenInput />
      <SegmentedControl.ItemText>
        {o.label}
        {#if o.count !== undefined}
          <span class="tabular-nums opacity-70 ml-1">{o.count}</span>
        {/if}
      </SegmentedControl.ItemText>
    </SegmentedControl.Item>
  {/each}
  <SegmentedControl.Indicator />
</SegmentedControl>
