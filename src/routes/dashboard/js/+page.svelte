<script lang="ts">
  import type { PageData } from './$types';
  import Fa from 'svelte-fa';
  import {
    faCalendarDays,
    faGripLines,
    faList,
    faLocationDot,
    faPlus
  } from '@fortawesome/free-solid-svg-icons';
  import { _ } from 'svelte-i18n';
  import { formatDate } from '$lib/jsExport';

  let { data }: { data: PageData } = $props();
</script>

<div class="page-header">
  <h1>{$_('page.js.title')}</h1>
  {#if data.canWrite}
    <a href="/dashboard/js/new" class="btn preset-filled-primary-500">
      <Fa icon={faPlus} />
      <span>{$_('page.js.create_course')}</span>
    </a>
  {/if}
</div>

<p class="text-sm text-surface-600-400 mb-4">{$_('page.js.intro')}</p>

{#if data.courses.length === 0}
  <div class="empty-state">
    <p class="text-surface-600-400">{$_('page.js.no_courses')}</p>
  </div>
{:else}
  <ul class="flex flex-col gap-2">
    {#each data.courses as course (course.id)}
      <li class="list-item">
        <span class="list-item-content">
          <dt class="font-bold truncate">{course.title}</dt>
          <dd class="flex flex-wrap items-center gap-2 text-sm text-surface-600-400">
            <span class="meta-item">
              <Fa icon={faCalendarDays} size="sm" />
              {formatDate(course.date_from)} – {formatDate(course.date_to)}
            </span>
            {#if course.location}
              <span class="meta-item truncate">
                <Fa icon={faLocationDot} size="sm" />
                {course.location}
              </span>
            {/if}
            <span class="meta-item">
              <Fa icon={faList} size="sm" />
              {$_('page.js.training_count', {
                values: { count: course.js_course_trainings?.length ?? 0 }
              })}
            </span>
            {#if course.course_number}
              <span class="meta-item">#{course.course_number}</span>
            {/if}
          </dd>
        </span>
        <span class="flex-none">
          <a class="btn preset-tonal-primary" href="/dashboard/js/{course.id}">
            <Fa icon={faGripLines} />
            <span class="hidden sm:inline">{$_('button.view')}</span>
          </a>
        </span>
      </li>
    {/each}
  </ul>
{/if}
