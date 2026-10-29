"""What a layer run prints: counts, ids and codes only (the log is public).

Every value printed comes from the layer's answers, which hold codes, ids
and counts by design; strings are still checked against a code pattern
before they are printed, so a changed answer cannot leak a value.
"""
import re

CODE = re.compile(r'^[a-z0-9_]{1,60}( [a-z0-9_]{1,60})?$')
HINT = re.compile(r'^accept_[a-z_]{1,30}=\d{1,6}$')

# The result counts in the order of the layer's contract (C3)
ORDER = {
    'members': ['received', 'inserted', 'adopted', 'revived', 'updated', 'unchanged', 'invalid',
                'conflicts', 'held', 'write_failed', 'gone', 'former', 'statuses_recomputed'],
    'events': ['received', 'inserted', 'adopted', 'revived', 'updated', 'unchanged', 'gone',
               'deleted', 'kept', 'breaks_inserted', 'breaks_adopted', 'breaks_updated',
               'breaks_deleted', 'registrations_added', 'registrations_removed',
               'registrations_adopted', 'invalid', 'conflicts', 'write_failed', 'ignored',
               'out_of_scope'],
}

# What a refusal means, for its error line
REFUSED = {
    'empty_snapshot': 'the provider answered no records at all; check the provider and its API key',
    'members_gone': '{n} members would be marked gone at once (limit {limit})',
    'status_drop': '{n} of {counting} members would lose their active or passive membership '
                   '(they would become {became})',
    'status_gain': '{n} members would start to count as active or passive at once and be let in '
                   '(limit {limit})',
    'events_gone': '{n} events or holidays would be gone at once (limit {limit})',
}

# Counts that make a run end as a warning (records not written)
NOT_WRITTEN = ('invalid', 'conflicts', 'held', 'write_failed')


def code(value):
    """A code from an answer, or '?' when it does not look like one."""
    return value if isinstance(value, str) and CODE.match(value) else '?'


def number(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def counts(values, order=()):
    """'received 538, inserted 0, ...': numbers only, known keys first."""
    if not isinstance(values, dict):
        return ''
    keys = [k for k in order if k in values] + sorted(k for k in values if k not in order)
    return ', '.join(f"{code(k)} {values[k]}" for k in keys if number(values[k]) is not None)


def by_status(values):
    """'left: 2, non_member: 1' (status names and counts)."""
    if not isinstance(values, dict) or not values:
        return 'nothing'
    return ', '.join(f"{code(k)}: {values[k]}" for k in sorted(values) if number(values[k]) is not None)


def refusal_line(kind, run_id, guard, hint, dry=False):
    """The error line of a refused run with its override. A dry run only
    says what a real run would meet."""
    reason = code(guard.get('refused'))
    plan = guard.get(kind) if isinstance(guard.get(kind), dict) else {}
    status = guard.get('status') if isinstance(guard.get('status'), dict) else {}
    if reason == 'members_gone':
        n = (number(plan.get('to_gone')) or 0) + (number(plan.get('former')) or 0)
        limit = plan.get('limit')
    elif reason == 'events_gone':
        n, limit = plan.get('to_gone'), plan.get('limit')
    elif reason == 'status_drop':
        n, limit = status.get('dropping'), status.get('limit')
    else:
        n, limit = status.get('gaining'), status.get('limit')
    text = REFUSED.get(reason, 'refused').format(
        n=number(n), limit=number(limit), counting=number(status.get('counting')),
        became=by_status(status.get('became')))
    valid_hint = isinstance(hint, str) and HINT.match(hint)
    if dry:
        line = f"Dry run: layer {kind} run {run_id} would be refused ({reason}): {text}."
        return line + (f" A real run would need {hint}" if valid_hint else '')
    line = f"Error: layer {kind} run {run_id} refused ({reason}): {text}; nothing written."
    if valid_hint:
        line += (" Check the provider; if the change is intended, run the workflow by hand "
                 f"with {hint}")
    return line


def apply_lines(kind, run_id, applied):
    """The apply's answer as log lines (no warning or error lines)."""
    lines = []
    status = code(applied.get('status'))
    dry = ' (dry run: nothing written)' if applied.get('dry_run') else ''
    lines.append(f"Layer {kind} run {run_id}: {status}{dry}")
    result = applied.get('result') if isinstance(applied.get('result'), dict) else {}
    if result:
        lines.append(f"  {counts(result, ORDER.get(kind, ()))}")
    guard = applied.get('guard') if isinstance(applied.get('guard'), dict) else {}
    plan = guard.get(kind) if isinstance(guard.get(kind), dict) else None
    if plan:
        former = f", former {plan.get('former')}" if number(plan.get('former')) is not None else ''
        lines.append(f"  gone: {number(plan.get('to_gone'))} of {number(plan.get('active_links'))} "
                     f"live links{former} (limit {number(plan.get('limit'))}, "
                     f"{'complete' if plan.get('complete') else 'partial'} snapshot)")
    st = guard.get('status') if isinstance(guard.get('status'), dict) else None
    if st:
        became = f"; they become {by_status(st.get('became'))}" if st.get('became') else ''
        lines.append(f"  status: {number(st.get('dropping'))} of {number(st.get('counting'))} counting "
                     f"stop, {number(st.get('gaining'))} start (limit {number(st.get('limit'))}){became}")
    accepted = applied.get('accepted')
    if isinstance(accepted, dict) and accepted:
        lines.append(f"  accepted: {by_status(accepted)}")
    issues = result.get('issues') if isinstance(result.get('issues'), dict) else None
    if issues:
        lines.append(f"  issues: {counts(issues, ('noted', 'resolved', 'open'))}")
    return lines


def warning_lines(kind, run_id, applied, finished, errors):
    """::warning:: annotations: a run that ends as a warning, new catalog
    rows to review, issues seen in this run."""
    lines = []
    result = applied.get('result') if isinstance(applied, dict) and isinstance(applied.get('result'), dict) else {}
    guard = applied.get('guard') if isinstance(applied, dict) and isinstance(applied.get('guard'), dict) else {}
    final = code((finished or {}).get('status'))
    if final == 'warning':
        # As integration_finish counts them (an event without date is info)
        not_written = {k: result.get(k) for k in NOT_WRITTEN if number(result.get(k))}
        if kind == 'events':
            not_written.pop('invalid', None)
        detail = f" ({by_status(not_written)})" if not_written else ''
        lines.append(f"::warning::Layer {kind} run {run_id} ended with a warning: "
                     f"{sum(not_written.values())} records not written{detail}, {errors} fetch "
                     "errors. See integration_issues (Integrations page)")
    new = number(guard.get('new_catalog_rows'))
    if new:
        lines.append(f"::warning::{new} new groups or calendars to review "
                     "(integration_member_groups, integration_calendars)")
    issues = result.get('issues') if isinstance(result.get('issues'), dict) else {}
    if number(issues.get('noted')):
        lines.append(f"::warning::{issues['noted']} {kind} issues seen in this run "
                     f"({number(issues.get('open'))} open in all). See integration_issues")
    return lines


def final_lines(kind, run_id, applied, finished, dry=False):
    """Error lines for a refused or failed run, and the final status."""
    lines = []
    final = code((finished or {}).get('status')) if finished else 'failed'
    if final == 'refused' and isinstance(applied, dict):
        lines.append(refusal_line(kind, run_id, applied.get('guard') or {}, applied.get('hint'), dry))
    elif final == 'failed' and finished is None and isinstance(applied, dict) \
            and applied.get('status') in ('applied', 'refused'):
        # The apply committed on its own; only closing the run failed. The
        # database closes it after an hour, and a re-run until then gets
        # RUN_IN_PROGRESS.
        lines.append(f"Error: layer {kind} run {run_id} was {code(applied.get('status'))} but "
                     "could not be closed; it closes itself after an hour (a re-run gets "
                     "RUN_IN_PROGRESS until then)")
    elif final == 'failed':
        error = (finished or {}).get('error') or (applied or {}).get('error')
        lines.append(f"Error: layer {kind} run {run_id} failed ({code(error) if error else 'not applied'})")
    lines.append(f"Final: {final}")
    return lines


def exit_code(final):
    """0 only when the run ended ok: a warning, a refusal or a failure turns
    the workflow red (and healthchecks.io with it)."""
    return 0 if final == 'ok' else 1
