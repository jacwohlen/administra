<script lang="ts">
  import { toaster } from '#lib/toast.ts';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faCheck, faRightLeft, faSpinner, faXmark } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import type { PlanRow } from '#lib/trainingPlanUtils.ts';
  import { mailLocale } from '#lib/trainingPlanMailText.ts';
  import {
    postRequestAction,
    requestStillValid,
    type PlanRequest,
    type RequestEvent
  } from '#lib/trainingPlanRequests.ts';
  import { requestToast } from './requestToast';

  let {
    requests,
    rows,
    mine,
    memberName,
    today,
    onchanged
  }: {
    /** The open requests */
    requests: PlanRequest[];
    rows: PlanRow[];
    /** The account's members (my_member_ids()) */
    mine: Set<number>;
    memberName: Map<number, string>;
    today: string;
    onchanged: () => void;
  } = $props();

  let incoming = $derived(requests.filter((r) => mine.has(r.to_member_id)));
  let outgoing = $derived(
    requests.filter((r) => mine.has(r.from_member_id) && !mine.has(r.to_member_id))
  );
  let busy = $state<number | null>(null);

  const name = (id: number) => memberName.get(id) ?? '?';

  // A date outside the year shown is not loaded: the database checks it on accepting
  const loaded = (trainingId: number | null, date: string | null) =>
    rows.some((row) => row.training.id === trainingId && row.date === date);
  const valid = (r: PlanRequest) =>
    !loaded(r.training_id, r.date) ||
    (r.kind === 'swap' && !loaded(r.other_training_id, r.other_date)) ||
    requestStillValid(r, rows, today);

  function slot(trainingId: number | null, date: string | null) {
    const row = rows.find((r) => r.training.id === trainingId && r.date === date);
    const day = date ? dayjs(date) : null;
    const label = row
      ? `${$_('weekdayShort.' + row.training.weekday)} ${day?.format('DD.MM.')} ${row.training.title} ${row.training.dateFrom}`
      : (day?.format('DD.MM.YYYY') ?? '');
    return { label, topic: row?.session?.topic ?? null };
  }

  async function act(r: PlanRequest, action: 'accept' | 'decline' | 'withdraw') {
    busy = r.id;
    const res = await postRequestAction(
      action === 'withdraw'
        ? { action: 'withdraw', id: r.id }
        : { action: 'answer', id: r.id, accept: action === 'accept' },
      mailLocale($locale)
    );
    busy = null;
    if (!res.ok) {
      toaster.error({ title: $_(`page.trainingPlan.request.error.${res.code}`) });
    } else if (res.status === 'expired') {
      toaster.warning({ title: $_('page.trainingPlan.request.done.expired') });
    } else if (['accepted', 'declined', 'withdrawn'].includes(res.status)) {
      const other = action === 'withdraw' ? r.to_member_id : r.from_member_id;
      requestToast($_, res.status as RequestEvent, res.mail, name(other));
    }
    onchanged();
  }
</script>

{#snippet what(r: PlanRequest, forMe: boolean)}
  {@const a = slot(r.training_id, r.date)}
  {#if r.kind === 'swap'}
    {@const b = slot(r.other_training_id, r.other_date)}
    <p>
      {forMe
        ? $_('page.trainingPlan.request.inSwap', { values: { name: name(r.from_member_id) } })
        : $_('page.trainingPlan.request.outSwap', { values: { name: name(r.to_member_id) } })}
    </p>
    <ul class="list-disc ml-5">
      <li>
        {forMe
          ? $_('page.trainingPlan.request.youTake', { values: { date: a.label } })
          : $_('page.trainingPlan.request.theyTake', {
              values: { name: name(r.to_member_id), date: a.label }
            })}{#if b.topic}
          · {$_('page.trainingPlan.topic')}: {b.topic}{/if}
      </li>
      <li>
        {forMe
          ? $_('page.trainingPlan.request.theyTake', {
              values: { name: name(r.from_member_id), date: b.label }
            })
          : $_('page.trainingPlan.request.youTake', { values: { date: b.label } })}{#if a.topic}
          · {$_('page.trainingPlan.topic')}: {a.topic}{/if}
      </li>
    </ul>
  {:else}
    <p>
      {forMe
        ? $_('page.trainingPlan.request.inSubstitute', {
            values: { name: name(r.from_member_id), date: a.label }
          })
        : $_('page.trainingPlan.request.outSubstitute', {
            values: { name: name(r.to_member_id), date: a.label }
          })}{#if a.topic}
        · {$_('page.trainingPlan.topic')}: {a.topic}{/if}
    </p>
  {/if}
  {#if r.message}
    <p class="italic">„{r.message}“</p>
  {/if}
{/snippet}

{#if incoming.length > 0 || outgoing.length > 0}
  <div class="space-y-2 mb-4 print:hidden">
    {#each incoming as r (r.id)}
      {@const ok = valid(r)}
      <div
        class="flex flex-wrap items-start gap-x-2 gap-y-3 p-3 rounded-lg preset-tonal-primary text-sm"
      >
        <Fa icon={faRightLeft} class="mt-0.5 flex-none" />
        <div class="flex-1 min-w-[12rem] space-y-1">
          {@render what(r, true)}
          {#if !ok}
            <p class="text-xs font-semibold">{$_('page.trainingPlan.request.stale')}</p>
          {/if}
        </div>
        <div class="flex gap-2 ml-auto">
          <button
            type="button"
            class="btn btn-sm preset-tonal-surface"
            disabled={busy === r.id}
            onclick={() => act(r, 'decline')}
          >
            <Fa icon={faXmark} />
            <span>{$_('page.trainingPlan.request.decline')}</span>
          </button>
          {#if ok}
            <button
              type="button"
              class="btn btn-sm preset-filled-primary-500"
              disabled={busy === r.id}
              onclick={() => act(r, 'accept')}
            >
              <Fa icon={busy === r.id ? faSpinner : faCheck} spin={busy === r.id} />
              <span>{$_('page.trainingPlan.request.accept')}</span>
            </button>
          {/if}
        </div>
      </div>
    {/each}
    {#each outgoing as r (r.id)}
      <div
        class="flex flex-wrap items-start gap-x-2 gap-y-3 p-3 rounded-lg bg-surface-100-900 text-sm"
      >
        <Fa icon={faRightLeft} class="mt-0.5 flex-none" />
        <div class="flex-1 min-w-[12rem] space-y-1">
          {@render what(r, false)}
          <p class="text-xs opacity-80">
            {valid(r)
              ? $_('page.trainingPlan.request.waiting')
              : $_('page.trainingPlan.request.stale')}
          </p>
        </div>
        <button
          type="button"
          class="btn btn-sm preset-tonal-surface ml-auto"
          disabled={busy === r.id}
          onclick={() => act(r, 'withdraw')}
        >
          <Fa icon={busy === r.id ? faSpinner : faXmark} spin={busy === r.id} />
          <span>{$_('page.trainingPlan.request.withdraw')}</span>
        </button>
      </div>
    {/each}
  </div>
{/if}
