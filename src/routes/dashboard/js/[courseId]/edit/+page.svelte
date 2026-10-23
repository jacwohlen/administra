<script lang="ts">
  import type { PageData } from './$types';
  import { _ } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import CourseForm from '../../CourseForm.svelte';

  let { data }: { data: PageData } = $props();
</script>

<div class="page-header-back">
  <a href="/dashboard/js/{data.course.id}" class="btn preset-tonal-surface">
    <Fa icon={faArrowLeft} />
  </a>
  <h1>{$_('page.js.edit_course')}</h1>
</div>

<CourseForm
  course={data.course}
  trainings={data.trainings}
  cancelHref="/dashboard/js/{data.course.id}"
/>
