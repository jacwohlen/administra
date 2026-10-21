<script lang="ts">
  import { goto } from '$app/navigation';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import ExamForm from '../ExamForm.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<div class="page-header-back">
  <a href="/dashboard/exams" class="btn preset-tonal-surface">
    <Fa icon={faArrowLeft} />
  </a>
  <h1>{$_('page.exams.create')}</h1>
</div>

<ExamForm
  events={data.events}
  cancelHref="/dashboard/exams"
  onsaved={(id) => goto(`/dashboard/exams/${id}`)}
/>
