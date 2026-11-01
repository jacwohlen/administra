<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { _, locale } from 'svelte-i18n';
  import Fa from 'svelte-fa';
  import {
    faCircleCheck,
    faCircleExclamation,
    faCircleQuestion,
    faPaperPlane,
    faSpinner,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import dayjs from 'dayjs';
  import { modalDialog } from '$lib/modalDialog';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { clubConfig } from '$lib/clubConfig';
  import { supabaseClient } from '$lib/supabase';
  import { toaster } from '$lib/toast';
  import type { TrainingPlanMailLog } from '$lib/models';
  import {
    computeNotices,
    fingerprint,
    type MailPlanData,
    type MailScope,
    type MemberNotice,
    type NoticeSet,
    type RecipientGroup,
    type UnreachableMember
  } from '$lib/trainingPlanMail';
  import { mailLocale, memberBlocks, renderMail } from '$lib/trainingPlanMailText';
  import { loadMailPlan } from '$lib/trainingPlanMailData';
  import { postNotify, type MailMode, type NotifyResponse } from '$lib/trainingPlanMailClient';

  /**
   * "Trainer informieren" (docs/TRAINING_PLAN.md): every trainer whose plan
   * changed since they were last told, grouped by address, with the lines of
   * their mail. Sending goes one address per request, one after the other
   * (the server recomputes each mail and checks the preview's fingerprint);
   * "als mitgeteilt markieren" stores what they were told without a mail.
   * Sending and marking are separate choices: a mail card's box picks it for
   * sending; the footer marks only the ticked cards without a mail and sent
   * mails whose told state was not saved, a mail card is marked by its own
   * button. Waits for the plan's reload first, so what the table just saved
   * is in.
   */
  let {
    mode,
    scope,
    senderName,
    senderEmail,
    waiting = false,
    onclose
  }: {
    /** smtp: mails leave; demo, test: sending is simulated */
    mode: MailMode;
    /** The trainings this account plans: the TK all, a main trainer their own */
    scope: MailScope;
    /** Signs the mail: the profile's name, else the sign-in address */
    senderName: string;
    /** Where replies go (the server sets it as Reply-To) */
    senderEmail: string | null;
    /** The plan is being reloaded with what the table saved: load after it */
    waiting?: boolean;
    onclose: () => void;
  } = $props();

  /** Lines shown per member before "N weitere Zeilen anzeigen" */
  const PREVIEW_LINES = 8;
  /** The endpoint takes this many members per request */
  const MAX_MEMBERS = 500;

  type CardStatus = 'sending' | 'sent' | 'simulated' | 'skipped' | 'failed' | 'marked' | 'unknown';
  interface CardState {
    status: CardStatus;
    error?: string;
    /** Sent, but what they were told is not saved: they stay pending */
    toldNotSaved?: boolean;
  }
  /** One address to mail, or one member who gets no mail */
  type Card =
    | { kind: 'mail'; key: string; members: MemberNotice[]; group: RecipientGroup }
    | { kind: 'other'; key: string; members: MemberNotice[]; entry: UnreachableMember };
  type HistoryRow = Pick<
    TrainingPlanMailLog,
    'id' | 'member_id' | 'to_email' | 'status' | 'error' | 'created_at'
  > & { member: { firstname: string; lastname: string } | null };

  let phase = $state<'waiting' | 'loading' | 'ready' | 'error'>('waiting');
  let data = $state.raw<MailPlanData | null>(null);
  let set = $state.raw<NoticeSet | null>(null);
  /** Loading again after sending or marking, with the old preview still shown */
  let refreshing = $state(false);
  let busy = $state<'send' | 'mark' | null>(null);
  let confirming = $state(false);
  /** Members whose opt-out is being saved */
  let toggling = $state<number[]>([]);
  /** By card key; kept across reloads */
  let states = $state<Record<string, CardState>>({});
  /**
   * Checked or not, where the planner chose; else mail cards are checked
   * (for sending) unless a mail to them may have left already
   */
  let choices = $state<Record<string, boolean>>({});
  /** Cards sent or marked here, shown with their status once no longer pending */
  let finished = $state.raw<Record<string, Card>>({});
  let expanded = $state<string[]>([]);
  let mailShown = $state<string[]>([]);
  let history = $state.raw<HistoryRow[] | null>(null);
  let historyFailed = $state(false);
  let closeButton = $state<HTMLButtonElement>();

  let closed = false;
  onDestroy(() => (closed = true));

  // The mail's language is the app's, as the server is told
  let mailLang = $derived(mailLocale($locale));
  let simulated = $derived(mode === 'demo' || mode === 'test');
  let mailContext = $derived({
    locale: mailLang,
    clubName: clubConfig.name,
    origin: window.location.origin,
    senderName
  });

  let mailCards = $derived<Card[]>(
    (set?.groups ?? []).map((group) => ({
      kind: 'mail',
      key: `mail:${group.key}`,
      members: group.members,
      group
    }))
  );
  let otherCards = $derived<Card[]>(
    (set?.unreachable ?? []).map((entry) => ({
      kind: 'other',
      key: `member:${entry.member.memberId}`,
      members: [entry.member],
      entry
    }))
  );
  let finishedMail = $derived(
    Object.values(finished).filter(
      (c) => c.kind === 'mail' && !mailCards.some((m) => m.key === c.key)
    )
  );
  let finishedOther = $derived(
    Object.values(finished).filter(
      (c) => c.kind === 'other' && !otherCards.some((m) => m.key === c.key)
    )
  );

  /** When a mail to the card's members may have left already (log row still pending) */
  const unclearSince = (card: Card) =>
    card.members
      .map((m) => m.unclearSince)
      .filter((at): at is string => !!at)
      .sort()
      .at(-1) ?? null;
  // A mail card is picked for sending unless a mail to it may have left
  // already; a card without mail only when ticked, for marking
  const isChecked = (card: Card) =>
    choices[card.key] ?? (card.kind === 'mail' && !unclearSince(card));
  // Sent or marked in this dialog: not sent again (a mail whose told state
  // was not saved stays pending, to be marked)
  const isDone = (key: string) =>
    ['sent', 'simulated', 'marked'].includes(states[key]?.status ?? '');

  let toSend = $derived(mailCards.filter((c) => isChecked(c) && !isDone(c.key)));
  // Never a mail card that was not sent: only the ticked cards without mail,
  // and mails that left but were not saved as told
  let toMark = $derived([
    ...mailCards.filter((c) => states[c.key]?.toldNotSaved),
    ...otherCards.filter((c) => isChecked(c))
  ]);
  let markCount = $derived(toMark.reduce((n, c) => n + c.members.length, 0));
  let canAct = $derived(phase === 'ready' && !busy && !refreshing);

  $effect(() => {
    if (waiting || phase !== 'waiting') return;
    // The table saves when the dialog opens and the page starts its reload
    // in the same update: look again once that has happened
    tick().then(() => {
      if (!closed && !waiting && phase === 'waiting') load();
    });
  });

  let request = 0;
  async function load(keepShown = false) {
    const id = ++request;
    if (keepShown && set) refreshing = true;
    else phase = 'loading';
    try {
      const next = await loadMailPlan(supabaseClient, scope);
      if (closed || id !== request) return;
      data = next;
      set = computeNotices(next, scope);
      phase = 'ready';
    } catch (error) {
      if (closed || id !== request) return;
      console.error('Error loading the plan mails:', error);
      phase = 'error';
    } finally {
      if (id === request) refreshing = false;
    }
    if (history) loadHistory();
  }

  function names(card: Card) {
    return card.members.map((m) => `${m.firstname} ${m.lastname}`).join(', ');
  }

  type FailureCode = Extract<NotifyResponse, { ok: false }>['code'];
  // The server checks these before the fingerprint: the preview is outdated
  // (an opt-out, a new address, told meanwhile), nothing was sent
  const STALE_CODES: FailureCode[] = [
    'stale',
    'unreachable',
    'several_addresses',
    'nothing_pending'
  ];

  function failureText(code: FailureCode) {
    if (STALE_CODES.includes(code)) return $_('page.trainingPlan.notify.stale');
    if (code === 'not_allowed') return $_('page.trainingPlan.notify.notAllowed');
    return $_('page.trainingPlan.notify.requestFailed');
  }

  /**
   * After a change removed the focused element (a button of a card no
   * longer pending, the first-time box): focus `target`, else the Close
   * button, so Escape and Tab stay in the dialog
   */
  async function keepFocus(target?: () => HTMLElement | null | undefined) {
    await tick();
    if (closed || confirming) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    (target?.() ?? closeButton)?.focus({ preventScroll: true });
  }

  async function send() {
    const queue = toSend;
    if (!canAct || queue.length === 0) return;
    busy = 'send';
    const counts = { sent: 0, simulated: 0, failed: 0 };
    try {
      for (const card of queue) {
        if (closed || card.kind !== 'mail') return;
        states[card.key] = { status: 'sending' };
        const res = await postNotify({
          action: 'send',
          memberIds: card.members.map((m) => m.memberId),
          fingerprint: fingerprint(card.members, card.group.key),
          locale: mailLang
        });
        if (closed) return;
        if (res.ok) {
          const status: CardStatus =
            res.status === 'skipped' && res.simulated
              ? 'simulated'
              : res.status === 'sent' || res.status === 'skipped'
                ? res.status
                : 'failed';
          const told = status === 'sent' || status === 'simulated';
          // The server's reason is a detail for failures; "Simuliert" says it all
          const error = status === 'simulated' ? undefined : res.error;
          states[card.key] = { status, error, toldNotSaved: told && !res.toldSaved };
          if (told) {
            finished = { ...finished, [card.key]: card };
            counts[status]++;
          } else {
            counts.failed++;
          }
          continue;
        }
        // Netlify ends a function that ran too long with a bare 502/504, and
        // a lost connection leaves it open too: the mail may have left, so
        // it is not sent again unless checked again, and stays in the list
        // with its status even when it was saved as told after all. Its log
        // row stays pending, so the card is unchecked when opened again too.
        if (res.code === 'timeout' || res.code === 'network') {
          states[card.key] = { status: 'unknown' };
          choices[card.key] = false;
          finished = { ...finished, [card.key]: card };
          toaster.error({
            title: $_('page.trainingPlan.notify.status.unknown'),
            description: names(card)
          });
        } else if (STALE_CODES.includes(res.code) || res.code === 'not_allowed') {
          delete states[card.key];
          toaster.error({ title: failureText(res.code) });
        } else {
          states[card.key] = { status: 'failed' };
          toaster.error({ title: failureText(res.code) });
        }
        break;
      }
    } finally {
      busy = null;
    }
    if (counts.sent > 0) {
      toaster.success({
        title: $_('page.trainingPlan.notify.sentCount', { values: { count: counts.sent } })
      });
    }
    if (counts.simulated > 0) {
      toaster.success({
        title: $_('page.trainingPlan.notify.simulatedCount', {
          values: { count: counts.simulated }
        })
      });
    }
    if (counts.failed > 0) {
      toaster.error({
        title: $_('page.trainingPlan.notify.failedCount', { values: { count: counts.failed } })
      });
    }
    await load(true);
    keepFocus();
  }

  /** Marks the cards' members as told, without a mail */
  async function mark(cards: Card[]) {
    if (!canAct || cards.length === 0) return;
    busy = 'mark';
    let marked = 0;
    try {
      // Whole cards per request, at most MAX_MEMBERS members each
      const batches: Card[][] = [];
      for (const card of cards) {
        const last = batches.at(-1);
        const size = last?.reduce((n, c) => n + c.members.length, 0) ?? 0;
        if (last && size + card.members.length <= MAX_MEMBERS) last.push(card);
        else batches.push([card]);
      }
      for (const batch of batches) {
        const members = batch.flatMap((c) => c.members);
        const res = await postNotify({
          action: 'mark',
          memberIds: members.map((m) => m.memberId),
          fingerprint: fingerprint(members, null),
          locale: mailLang
        });
        if (closed) return;
        if (!res.ok) {
          toaster.error({ title: failureText(res.code) });
          break;
        }
        marked += members.length;
        for (const card of batch) {
          states[card.key] = { status: 'marked' };
          delete choices[card.key];
        }
        finished = { ...finished, ...Object.fromEntries(batch.map((c) => [c.key, c])) };
      }
    } finally {
      busy = null;
      confirming = false;
    }
    if (marked > 0) {
      toaster.success({
        title: $_('page.trainingPlan.notify.markedCount', { values: { count: marked } })
      });
    }
    await load(true);
    keepFocus();
  }

  async function toggleOptOut(memberId: number, on: boolean) {
    toggling = [...toggling, memberId];
    try {
      const table = supabaseClient.from('training_plan_mail_optouts');
      const { error } = on
        ? await table.insert({ member_id: memberId })
        : await table.delete().eq('member_id', memberId);
      // Opted out by someone else meanwhile: just as good
      if (error && !(on && error.code === '23505')) throw error;
      if (closed || !data) return;
      const optOuts = data.optOuts.filter((id) => id !== memberId);
      data = { ...data, optOuts: on ? [...optOuts, memberId] : optOuts };
      set = computeNotices(data, scope);
    } catch (error) {
      console.error('Error saving the opt-out:', error);
      toaster.error({ title: $_('page.trainingPlan.notify.optOutError') });
    } finally {
      toggling = toggling.filter((id) => id !== memberId);
    }
  }

  async function loadHistory() {
    historyFailed = false;
    try {
      const { data: rows, error } = await supabaseClient
        .from('training_plan_mails')
        .select(
          'id, member_id, to_email, status, error, created_at, member:members (firstname, lastname)'
        )
        .order('created_at', { ascending: false })
        .limit(20)
        .returns<HistoryRow[]>();
      if (error) throw error;
      if (!closed) history = rows ?? [];
    } catch (error) {
      console.error('Error loading the plan mail log:', error);
      if (!closed) historyFailed = true;
    }
  }

  function toggle(list: string[], key: string) {
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  }

  /** The first `limit` lines, with the headings of their trainings */
  function firstLines(blocks: { heading: string; lines: string[] }[], limit: number) {
    const shown: typeof blocks = [];
    let left = limit;
    for (const block of blocks) {
      if (left <= 0) break;
      shown.push({ heading: block.heading, lines: block.lines.slice(0, left) });
      left -= block.lines.length;
    }
    return shown;
  }

  function close() {
    if (busy || confirming) return;
    onclose();
  }
</script>

{#snippet statusLine(card: Card)}
  {@const key = card.key}
  {@const current = states[key]}
  {@const since = unclearSince(card)}
  {#if !current && since}
    <p role="status" class="flex items-start gap-1.5 text-sm text-warning-700-300">
      <Fa icon={faCircleQuestion} class="mt-0.5 flex-none" />
      <span>
        {$_('page.trainingPlan.notify.unclear', {
          values: { date: dayjs(since).format('DD.MM.YYYY HH:mm') }
        })}
      </span>
    </p>
  {/if}
  {#if current}
    {@const failed = current.status === 'failed' || current.status === 'skipped'}
    <div role="status" class="text-sm space-y-1">
      <p
        class="flex items-start gap-1.5 {failed
          ? 'text-error-700-300'
          : current.status === 'unknown'
            ? 'text-warning-700-300'
            : current.status === 'sending'
              ? 'text-surface-600-400'
              : 'text-success-700-300'}"
      >
        <Fa
          icon={current.status === 'sending'
            ? faSpinner
            : failed
              ? faCircleExclamation
              : current.status === 'unknown'
                ? faCircleQuestion
                : faCircleCheck}
          spin={current.status === 'sending'}
          class="mt-0.5 flex-none"
        />
        <span class="min-w-0">
          <span class="font-semibold">
            {$_(`page.trainingPlan.notify.status.${current.status}`)}
          </span>
          {#if current.error}
            <span class="block text-xs break-words">{current.error}</span>
          {/if}
        </span>
      </p>
      {#if current.toldNotSaved}
        <p class="flex items-start gap-1.5 text-warning-700-300 text-xs">
          <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
          <span>{$_('page.trainingPlan.notify.toldNotSaved')}</span>
        </p>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet memberLines(card: Card, member: MemberNotice)}
  {@const blocks = memberBlocks(member, mailLang)}
  {@const total = blocks.reduce((n, b) => n + b.lines.length, 0)}
  {@const key = `${card.key}|${member.memberId}`}
  {@const limit = expanded.includes(key) ? total : PREVIEW_LINES}
  <!-- Takes the focus from "N weitere Zeilen anzeigen", which goes away -->
  <div class="space-y-1.5 text-sm focus:outline-none" tabindex="-1">
    {#if card.members.length > 1}
      <p class="font-semibold">{member.firstname} {member.lastname}</p>
    {/if}
    {#each firstLines(blocks, limit) as block, i (i)}
      <div>
        <p class="font-medium">{block.heading}</p>
        <ul class="list-disc pl-5 text-surface-700-300 break-words">
          {#each block.lines as line, j (j)}
            <li>{line}</li>
          {/each}
        </ul>
      </div>
    {/each}
    {#if total > limit}
      <button
        type="button"
        class="btn btn-sm preset-tonal-surface"
        onclick={(e) => {
          const lines = e.currentTarget.parentElement;
          expanded = [...expanded, key];
          keepFocus(() => lines);
        }}
      >
        {$_('page.trainingPlan.notify.moreLines', { values: { count: total - limit } })}
      </button>
    {/if}
  </div>
{/snippet}

{#snippet optOuts(card: Card)}
  {#if scope.all && data}
    <div class="flex flex-wrap gap-x-4 gap-y-1">
      {#each card.members as member (member.memberId)}
        {@const label = `${$_('page.trainingPlan.notify.optOut')}: ${member.firstname} ${member.lastname}`}
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            class="checkbox"
            checked={data.optOuts.includes(member.memberId)}
            disabled={!!busy || refreshing || toggling.includes(member.memberId)}
            aria-label={label}
            onchange={(e) => {
              const box = e.currentTarget;
              toggleOptOut(member.memberId, box.checked).then(() => {
                // Not saved: the box shows what is stored
                if (box.isConnected && data) box.checked = data.optOuts.includes(member.memberId);
                // Saved: the card moved to the other list, with a new box
                else if (!box.isConnected) {
                  keepFocus(() =>
                    [...document.querySelectorAll<HTMLInputElement>('input.checkbox')].find(
                      (other) => other.getAttribute('aria-label') === label
                    )
                  );
                }
              });
            }}
          />
          <!-- With one member the card names them; screen readers hear it anyway -->
          <span>{card.members.length > 1 ? label : $_('page.trainingPlan.notify.optOut')}</span>
        </label>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet checkbox(card: Card)}
  <!-- 44 px tap area around the box; the negative margin keeps the card as it was -->
  <label class="flex flex-none -m-3 p-3 cursor-pointer">
    <input
      type="checkbox"
      class="checkbox size-5"
      checked={isChecked(card)}
      disabled={!!busy}
      onchange={(e) => (choices[card.key] = e.currentTarget.checked)}
      aria-label={$_('page.trainingPlan.notify.select', { values: { names: names(card) } })}
    />
  </label>
{/snippet}

{#snippet mailCard(card: Card, pending: boolean)}
  {#if card.kind === 'mail'}
    {@const shown = mailShown.includes(card.key)}
    <li class="card border border-surface-200-800 p-3 space-y-3">
      <div class="flex items-start gap-3">
        {#if pending}
          {@render checkbox(card)}
        {/if}
        <div class="flex-1 min-w-0">
          <p class="font-semibold">{names(card)}</p>
          <p class="text-sm text-surface-600-400 break-all">
            {card.group.address}
            {#if card.group.source === 'account'}
              <span class="chip preset-tonal-surface text-xs px-1.5 py-0.5 ml-1 whitespace-nowrap">
                {$_('page.trainingPlan.notify.accountAddress')}
              </span>
            {/if}
          </p>
        </div>
      </div>
      {@render statusLine(card)}
      {#if pending}
        {#each card.members as member (member.memberId)}
          {@render memberLines(card, member)}
        {/each}
        {@render optOuts(card)}
        <div class="space-y-2">
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-sm preset-tonal-surface"
              aria-expanded={shown}
              onclick={() => (mailShown = toggle(mailShown, card.key))}
            >
              {shown
                ? $_('page.trainingPlan.notify.hideMail')
                : $_('page.trainingPlan.notify.showMail')}
            </button>
            <!-- Told in person: this card only, on purpose, never with the mails -->
            <button
              type="button"
              class="btn btn-sm preset-tonal-surface"
              disabled={!canAct}
              aria-label={$_('page.trainingPlan.notify.markOneFor', {
                values: { names: names(card) }
              })}
              onclick={() => mark([card])}
            >
              {$_('page.trainingPlan.notify.markOne')}
            </button>
          </div>
          {#if shown}
            {@const mail = renderMail(card.members, mailContext)}
            <pre
              class="whitespace-pre-wrap break-words text-xs rounded-md bg-surface-100-900 p-3">{mail.text}</pre>
          {/if}
        </div>
      {/if}
    </li>
  {/if}
{/snippet}

{#snippet otherCard(card: Card, pending: boolean)}
  {#if card.kind === 'other'}
    <li class="card border border-surface-200-800 p-3 space-y-3">
      <div class="flex items-start gap-3">
        {#if pending}
          {@render checkbox(card)}
        {/if}
        <div class="flex-1 min-w-0">
          <p class="font-semibold">{names(card)}</p>
          <p class="text-sm text-warning-700-300">
            {$_(`page.trainingPlan.notify.reason.${card.entry.reason}`)}
            {#if card.entry.reason === 'opted_out' && card.entry.address}
              · <span class="break-all">{card.entry.address}</span>
            {/if}
          </p>
        </div>
      </div>
      {@render statusLine(card)}
      {#if pending}
        {@render memberLines(card, card.entry.member)}
        {@render optOuts(card)}
      {/if}
    </li>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-overlay"
  onclick={close}
  onkeydown={(e) => {
    if (e.key === 'Escape') close();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    use:modalDialog
    class="card modal-dialog modal-dialog-lg max-h-[90vh] overflow-y-auto space-y-4"
    onclick={(e) => e.stopPropagation()}
  >
    <h3>{$_('page.trainingPlan.notify.title')}</h3>
    <div class="space-y-1 text-sm">
      <p>{$_('page.trainingPlan.notify.intro')}</p>
      {#if senderEmail}
        <p class="text-surface-600-400 break-words">
          {$_('page.trainingPlan.notify.replyTo', { values: { email: senderEmail } })}
        </p>
      {/if}
      {#if mode === 'demo' || mode === 'test'}
        <p
          class="flex items-start gap-2 rounded-md bg-warning-500/10 px-3 py-2 text-warning-800-200"
        >
          <Fa icon={faTriangleExclamation} class="mt-0.5 flex-none" />
          <span>{$_(`page.trainingPlan.notify.${mode}`)}</span>
        </p>
      {/if}
    </div>

    {#if phase === 'waiting' || phase === 'loading'}
      <p role="status" class="flex items-center gap-2">
        <Fa icon={faSpinner} spin />
        {phase === 'waiting'
          ? $_('page.trainingPlan.notify.waiting')
          : $_('page.trainingPlan.notify.loading')}
      </p>
    {:else if phase === 'error'}
      <div class="space-y-2">
        <p role="alert" class="text-error-600-400">{$_('page.trainingPlan.notify.loadError')}</p>
        <button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => load()}>
          {$_('page.trainingPlan.notify.retry')}
        </button>
      </div>
    {:else if set}
      {#if refreshing}
        <p role="status" class="flex items-center gap-2 text-sm text-surface-600-400">
          <Fa icon={faSpinner} spin />
          {$_('page.trainingPlan.notify.loading')}
        </p>
      {/if}

      {#if set.members.length === 0}
        <p class="flex items-center gap-2 text-success-700-300">
          <Fa icon={faCircleCheck} />
          {$_('page.trainingPlan.notify.nothingPending')}
        </p>
      {:else if set.firstTime}
        <section class="rounded-lg preset-tonal-primary p-3 space-y-2 text-sm">
          <h4 class="font-semibold">{$_('page.trainingPlan.notify.firstTitle')}</h4>
          <p>{$_('page.trainingPlan.notify.firstHint')}</p>
          <button
            type="button"
            class="btn btn-sm preset-filled-primary-500"
            disabled={!canAct}
            onclick={() => (confirming = true)}
          >
            {$_('page.trainingPlan.notify.markAll')}
          </button>
        </section>
      {/if}

      {#if mailCards.length > 0 || finishedMail.length > 0}
        <section class="space-y-2">
          <h4 class="font-semibold">
            {$_('page.trainingPlan.notify.byMail', { values: { count: mailCards.length } })}
          </h4>
          <ul class="space-y-2">
            {#each mailCards as card (card.key)}
              {@render mailCard(card, true)}
            {/each}
            {#each finishedMail as card (card.key)}
              {@render mailCard(card, false)}
            {/each}
          </ul>
        </section>
      {/if}

      {#if otherCards.length > 0 || finishedOther.length > 0}
        <section class="space-y-2">
          <h4 class="font-semibold">
            {$_('page.trainingPlan.notify.notByMail', { values: { count: otherCards.length } })}
          </h4>
          <p class="text-sm text-surface-600-400">
            {$_('page.trainingPlan.notify.notByMailHint')}
          </p>
          <ul class="space-y-2">
            {#each otherCards as card (card.key)}
              {@render otherCard(card, true)}
            {/each}
            {#each finishedOther as card (card.key)}
              {@render otherCard(card, false)}
            {/each}
          </ul>
        </section>
      {/if}

      <details
        class="text-sm"
        ontoggle={(e) => {
          if (e.currentTarget.open && !history) loadHistory();
        }}
      >
        <summary class="cursor-pointer font-semibold py-1">
          {$_('page.trainingPlan.notify.history')}
        </summary>
        {#if historyFailed}
          <p class="text-error-600-400">{$_('page.trainingPlan.notify.historyError')}</p>
        {:else if !history}
          <p class="flex items-center gap-2 text-surface-600-400">
            <Fa icon={faSpinner} spin />
            {$_('page.trainingPlan.notify.historyLoading')}
          </p>
        {:else if history.length === 0}
          <p class="text-surface-600-400">{$_('page.trainingPlan.notify.historyEmpty')}</p>
        {:else}
          <ul class="divide-y divide-surface-200-800">
            {#each history as row (row.id)}
              <li class="py-1.5">
                <div class="flex flex-wrap justify-between gap-x-2">
                  <span class="font-medium">
                    {row.member ? `${row.member.firstname} ${row.member.lastname}` : '?'}
                  </span>
                  <span class="tabular-nums text-surface-600-400">
                    {dayjs(row.created_at).format('DD.MM.YYYY HH:mm')}
                  </span>
                </div>
                <div class="text-xs text-surface-600-400 break-words">
                  {$_(`page.trainingPlan.notify.historyStatus.${row.status}`)}
                  {#if row.to_email}· <span class="break-all">{row.to_email}</span>{/if}
                  {#if row.error}· {row.error}{/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </details>
    {/if}

    <!-- Stays in view while the list scrolls, covering the dialog's bottom padding:
         sticky offsets count from inside the padding, hence bottom = -padding -->
    <footer
      class="sticky -bottom-4 sm:-bottom-6 -mb-4 sm:-mb-6 flex flex-wrap justify-end gap-2 pt-3 pb-4 sm:pb-6 bg-surface-50-950 border-t border-surface-200-800"
    >
      <!-- Not while sending: the mails still to go would be dropped -->
      <button
        type="button"
        class="btn preset-tonal-surface"
        disabled={!!busy}
        bind:this={closeButton}
        onclick={close}
      >
        {$_('button.close')}
      </button>
      {#if phase === 'ready' && set && set.members.length > 0}
        <button
          type="button"
          class="btn preset-tonal-surface"
          disabled={!canAct || markCount === 0}
          onclick={() => mark(toMark)}
        >
          {#if busy === 'mark'}<Fa icon={faSpinner} spin />{/if}
          <span>{$_('page.trainingPlan.notify.mark', { values: { count: markCount } })}</span>
        </button>
        <button
          type="button"
          class="btn preset-filled-primary-500"
          disabled={!canAct || toSend.length === 0}
          onclick={send}
        >
          <Fa icon={busy === 'send' ? faSpinner : faPaperPlane} spin={busy === 'send'} />
          <span>
            {$_(`page.trainingPlan.notify.${simulated ? 'sendDemo' : 'send'}`, {
              values: { count: toSend.length }
            })}
          </span>
        </button>
      {/if}
    </footer>
  </div>
</div>

{#if confirming && set}
  <ConfirmDialog
    title={$_('page.trainingPlan.notify.markAllTitle')}
    message={$_('page.trainingPlan.notify.markAllMessage', {
      values: { count: set.members.length }
    })}
    confirmLabel={$_('page.trainingPlan.notify.markAll')}
    busy={busy === 'mark'}
    onconfirm={() => mark([...mailCards, ...otherCards])}
    oncancel={() => {
      if (!busy) confirming = false;
    }}
  />
{/if}
