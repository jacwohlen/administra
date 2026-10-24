<script lang="ts">
  import { _ } from 'svelte-i18n';
  import type { CandidateState } from '$lib/examUtils';
  import { EXAM_STATE_CLASS } from './examStyles';

  let { state }: { state: CandidateState } = $props();
</script>

<span class="chip text-xs flex-none {EXAM_STATE_CLASS[state]}">
  {$_('page.exams.state.' + state)}
</span>
