<script lang="ts">
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import CourseForm from '../CourseForm.svelte';

  let { data }: { data: PageData } = $props();
</script>

<div class="page-header-back">
  <a href="/dashboard/js" class="btn preset-tonal-surface">
    <Fa icon={faArrowLeft} />
  </a>
  <h1>{$_('page.js.create_course')}</h1>
</div>

<CourseForm trainings={data.trainings} cancelHref="/dashboard/js" />
