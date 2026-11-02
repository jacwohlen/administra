<script lang="ts">
  import { modalDialog } from '#lib/modalDialog.ts';
  import { toaster } from '#lib/toast.ts';
  import PillToggle from '#lib/components/PillToggle.svelte';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import { faArrowRight, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { planKey, type PlanRow } from '#lib/trainingPlanUtils.ts';
  import { mailLocale } from '#lib/trainingPlanMailText.ts';
  import {
    postRequestAction,
    swapCandidates,
    swapResult,
    type PlanRequest,
    type RequestKind
  } from '#lib/trainingPlanRequests.ts';
  import TrainerSelect from './TrainerSelect.svelte';
  import { requestToast } from './requestToast';
  import type { PlanMember } from './members';

  let {
    row,
    rows,
    members,
    bySlot,
    today,
    onclose,
    onsaved
  }: {
    /** The date the account's member leads and hands on */
    row: PlanRow;
    /** Every row of the plan, for the dates a swap can offer */
    rows: PlanRow[];
    members: PlanMember[];
    /** Open requests by date: those dates cannot be offered */
    bySlot: Map<string, PlanRequest>;
    today: string;
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  let kind = $state<RequestKind>('substitute');
  let toMember = $state<number | null | 'keep' | 'none'>(null);
  let otherKey = $state<string | null>(null);
  let message = $state('');
  let moveNote = $state(true);
  let otherMoveNote = $state(true);
  let saving = $state(false);

  // Anybody but the trainer of the date
  let others = $derived(members.filter((m) => m.id !== row.trainerId));
  let memberName = $derived(
    new Map(members.map((m) => [m.id, `${m.firstname} ${m.lastname}`] as const))
  );
  let candidates = $derived(
    typeof toMember !== 'number'
      ? []
      : swapCandidates(rows, toMember as number, today, (r) => bySlot.has(planKey(r)) || r === row)
  );
  let other = $derived(candidates.find((r) => planKey(r) === otherKey) ?? null);
  let preview = $derived(
    other
      ? swapResult(
          { topic: row.session?.topic ?? null, notes: row.session?.notes ?? null },
          { topic: other.session?.topic ?? null, notes: other.session?.notes ?? null },
          moveNote,
          otherMoveNote
        )
      : null
  );
  let ready = $derived(typeof toMember === 'number' && (kind === 'substitute' || other != null));

  function dateLabel(r: PlanRow) {
    return `${$_('weekdayShort.' + r.training.weekday)} ${dayjs(r.date).format('DD.MM.YYYY')} · ${r.training.title} ${r.training.dateFrom}`;
  }

  async function send() {
    if (!ready || typeof toMember !== 'number') return;
    saving = true;
    const res = await postRequestAction(
      {
        action: 'create',
        kind,
        trainingId: row.training.id,
        date: row.date,
        toMemberId: toMember,
        ...(kind === 'swap' && other
          ? { otherTrainingId: other.training.id, otherDate: other.date }
          : {}),
        message: message.trim() || null,
        moveNote,
        otherMoveNote
      },
      mailLocale($locale)
    );
    saving = false;
    if (!res.ok) {
      toaster.error({ title: $_(`page.trainingPlan.request.error.${res.code}`) });
      return;
    }
    requestToast($_, 'asked', res.mail, memberName.get(toMember) ?? '');
    onsaved();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-overlay"
  onclick={onclose}
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    use:modalDialog
    class="card modal-dialog modal-dialog-lg max-h-[90vh] overflow-y-auto"
    onclick={(e) => e.stopPropagation()}
  >
    <h3>{$_('page.trainingPlan.request.title')}</h3>
    <p class="text-sm text-surface-600-400 mb-3">
      {dateLabel(row)}{#if row.session?.topic}
        · {row.session.topic}{/if}
    </p>

    <form
      class="space-y-3"
      onsubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <PillToggle
        name="request-kind"
        label={$_('page.trainingPlan.request.title')}
        value={kind}
        options={(['substitute', 'swap'] as const).map((k) => ({
          value: k,
          label: $_('page.trainingPlan.request.kind.' + k)
        }))}
        onchange={(v) => (kind = v as RequestKind)}
      />
      <p class="text-xs text-surface-600-400">
        {$_('page.trainingPlan.request.kindHint.' + kind)}
      </p>

      <label class="label">
        <span>
          {kind === 'swap'
            ? $_('page.trainingPlan.request.swapWith')
            : $_('page.trainingPlan.request.askWho')}
        </span>
        <TrainerSelect
          members={others}
          bind:value={toMember}
          openLabel={$_('page.trainingPlan.request.pickPerson')}
          onchange={() => (otherKey = null)}
        />
      </label>

      {#if kind === 'swap' && typeof toMember === 'number'}
        {#if candidates.length === 0}
          <p class="text-sm p-3 rounded-lg preset-tonal-warning">
            {$_('page.trainingPlan.request.noDates', {
              values: { name: memberName.get(toMember) ?? '' }
            })}
          </p>
        {:else}
          <fieldset class="space-y-1">
            <legend class="text-sm mb-1">{$_('page.trainingPlan.request.pickDate')}</legend>
            {#each candidates as c (planKey(c))}
              <label class="flex items-center gap-2 text-sm cursor-pointer min-h-9">
                <input
                  type="radio"
                  class="radio"
                  name="swap-date"
                  value={planKey(c)}
                  checked={otherKey === planKey(c)}
                  onchange={() => (otherKey = planKey(c))}
                />
                <span>
                  {dateLabel(c)}{#if c.session?.topic}
                    <span class="text-surface-600-400"> · {c.session.topic}</span>{/if}
                </span>
              </label>
            {/each}
          </fieldset>
        {/if}

        {#if other && preview}
          <div class="p-3 rounded-lg bg-surface-100-900 text-sm space-y-2">
            <p class="font-semibold">{$_('page.trainingPlan.request.preview')}</p>
            {#each [{ r: row, who: toMember as number, next: preview.a }, { r: other, who: row.trainerId, next: preview.b }] as p (planKey(p.r))}
              <div class="flex items-start gap-2">
                <Fa icon={faArrowRight} size="sm" class="mt-1 flex-none" />
                <span>
                  <span class="font-semibold">{dateLabel(p.r)}</span><br />
                  {memberName.get(p.who ?? -1) ?? '?'}{#if p.next.topic}
                    · {p.next.topic}{/if}{#if p.next.notes}
                    <span class="italic text-surface-600-400"> · {p.next.notes}</span>{/if}
                </span>
              </div>
            {/each}
            {#if row.session?.notes?.trim()}
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" class="checkbox" bind:checked={moveNote} />
                <span>
                  {$_('page.trainingPlan.request.moveNote', {
                    values: { note: row.session.notes.trim() }
                  })}
                </span>
              </label>
            {/if}
            {#if other.session?.notes?.trim()}
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" class="checkbox" bind:checked={otherMoveNote} />
                <span>
                  {$_('page.trainingPlan.request.moveNote', {
                    values: { note: other.session.notes.trim() }
                  })}
                </span>
              </label>
            {/if}
          </div>
        {/if}
      {/if}

      <label class="label">
        <span>{$_('page.trainingPlan.request.message')}</span>
        <textarea
          class="textarea"
          rows="2"
          maxlength="500"
          placeholder={$_('page.trainingPlan.request.messagePlaceholder')}
          bind:value={message}
        ></textarea>
      </label>
      <p class="text-xs text-surface-600-400">{$_('page.trainingPlan.request.confirmHint')}</p>

      <footer class="flex justify-end gap-2 pt-2">
        <button type="button" class="btn preset-tonal-surface" onclick={onclose}>
          {$_('button.cancel')}
        </button>
        <button type="submit" class="btn preset-filled-primary-500" disabled={saving || !ready}>
          {#if saving}<Fa icon={faSpinner} spin />{/if}
          <span>{$_('page.trainingPlan.request.send')}</span>
        </button>
      </footer>
    </form>
  </div>
</div>
