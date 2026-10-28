"""One sync of one kind (members or events) in one of three modes.

    legacy  today's scripts, unchanged (the default, also when unset)
    shadow  legacy, then the same fetch as a dry run of the layer: the
            numbers show what the layer would do, nothing is written
            through it (its run row and new catalog rows aside)
    layer   the layer; only when integration_begin is not on this database
            (Promotion 1 not done) the legacy scripts run instead

An adapter does the provider's side:
    adapter.connection           the connection id ('webling')
    adapter.plan(kind)           what the run covers, before it opens: an
                                 object with .scope (integration_begin's)
    adapter.empty_scope(kind)    the scope of a run whose plan failed
    adapter.records(plan, run)   the records to stage; run.today,
                                 run.scope, run.settings, run.version help
    adapter.errors, .counters    fetch errors and counters for finish
"""
from dataclasses import dataclass, field

from integration import report
from integration.anonymize import anonymize
from integration.layer import LAYER_MISSING, LayerError
from integration.safe_log import crash_line

MODES = ('legacy', 'shadow', 'layer')


class FetchFailed(Exception):
    """The provider could not be read as a whole (e.g. the member list): no
    record is staged and the run fails. The message is log-safe (method,
    path and status, see safe_log.py)."""


class UsageError(Exception):
    """The run cannot start as asked (e.g. no calendar matched)."""


class ConfigError(Exception):
    """A setting is missing (e.g. an environment variable)."""


@dataclass
class Options:
    kind: str
    mode: str = 'legacy'
    dry_run: bool = False
    trigger: str = 'manual'
    runner: str | None = None
    accept: dict = field(default_factory=dict)
    anonymize: bool = False


@dataclass
class Outcome:
    final: str
    run: int | None = None
    applied: dict | None = None
    finished: dict | None = None


def run(options, legacy, adapter, layer):
    """Runs the sync; returns the exit status.

    legacy:  () -> exit status of the legacy script
    adapter: () -> the provider adapter (built only when the layer runs)
    layer:   () -> integration.layer.Layer
    """
    mode = options.mode
    if mode not in MODES:
        print(f"Error: unknown mode {mode!r} (legacy, shadow or layer)")
        return 2
    print(f"Mode: {mode}{', dry run' if options.dry_run else ''}")
    if mode == 'legacy':
        if options.dry_run:
            print("Error: the legacy sync has no dry run; use mode shadow or layer")
            return 2
        return legacy()

    if mode == 'shadow' and not options.dry_run:
        status = legacy()
        shadow(options, adapter, layer)
        return status

    # layer, or a dry run (which never falls back: legacy would write)
    try:
        outcome = run_layer(options, adapter(), layer())
    except (LayerError, UsageError, ConfigError) as err:
        print(f"Error: {err}")
        return 2 if isinstance(err, UsageError) else 1
    if outcome is LAYER_MISSING:
        if options.dry_run:
            print("Error: the integration layer is not on this database, so there is nothing to "
                  "dry-run against")
            return 1
        print("::warning::The integration layer is not on this database yet (integration_begin "
              "missing); running the legacy sync instead")
        return legacy()
    return report.exit_code(outcome.final)


def shadow(options, adapter, layer):
    """The layer's dry run after the legacy sync. It never changes the
    exit status: the legacy sync is the one that wrote."""
    print(f"Shadow: the same {options.kind} as a dry run of the layer")
    dry = Options(**{**options.__dict__, 'dry_run': True})
    try:
        outcome = run_layer(dry, adapter(), layer())
    except Exception as err:
        known = (LayerError, UsageError, ConfigError)
        message = str(err) if isinstance(err, known) else crash_line(err)
        print(f"::warning::Shadow run of the layer failed: {message}")
        return None
    if outcome is LAYER_MISSING:
        print("::warning::Shadow run skipped: the integration layer is not on this database yet")
    elif outcome.final != 'ok':
        print(f"::warning::Shadow: the layer would have ended {outcome.final} "
              f"(run {outcome.run}); the legacy sync above is what counts tonight")
    return outcome


def run_layer(options, adapter, layer):
    """begin, stage, apply, finish. Returns an Outcome, or LAYER_MISSING
    when integration_begin is not on the database (nothing happened then).
    finish is always called once the run is open, also when the adapter
    crashes (error 'adapter_crash') or the layer fails mid-run."""
    kind = options.kind
    plan, error = None, None
    try:
        plan = adapter.plan(kind)
    except UsageError:
        raise
    except FetchFailed as err:
        print(f"Error: {err}")
        error = 'fetch_failed'
    except Exception as err:
        print(f"Error: reading {kind} failed: {crash_line(err)}")
        error = 'adapter_crash'
    scope = plan.scope if plan is not None else adapter.empty_scope(kind)

    opened = layer.begin(adapter.connection, kind, scope, dry_run=options.dry_run,
                         trigger=options.trigger, runner=options.runner)
    if opened is LAYER_MISSING:
        return LAYER_MISSING
    run_ = opened
    print(f"Layer {kind} run {run_.id} opened{' (dry run)' if options.dry_run else ''}")

    applied, finished = None, None
    outcome_error = error
    crashed = True
    try:
        if outcome_error is None:
            records = adapter.records(plan, run_)
            if options.anonymize and kind == 'members':
                records = [anonymized(r) for r in records]
            staged = run_.stage(records)
            print(f"Staged {staged['staged']} records in {staged['calls']} calls "
                  f"({staged['invalid']} with a problem)")
            if staged['dropped_keys']:
                # Key names only: what this database does not understand yet
                print(f"Not sent (unknown to this database): {', '.join(staged['dropped_keys'])}")
            applied = run_.apply(options.accept)
        crashed = False
    except FetchFailed as err:
        print(f"Error: {err}")
        outcome_error, crashed = 'fetch_failed', False
    except LayerError as err:
        print(f"Error: {err}")
        outcome_error, crashed = 'layer_error', False
    except Exception as err:
        print(f"Error: the {kind} adapter crashed: {crash_line(err)}")
        outcome_error, crashed = 'adapter_crash', False
    finally:
        sent = {'errors': adapter.errors, 'counters': dict(adapter.counters)}
        if crashed:
            # Interrupted (a BaseException passes through after this)
            outcome_error = 'adapter_crash'
        if outcome_error:
            sent['error'] = outcome_error
        try:
            finished = run_.finish(sent)
        except LayerError as err:
            print(f"Error: {err}")
            finished = None

    final = finished.get('status') if isinstance(finished, dict) else 'failed'
    if isinstance(applied, dict):
        for line in report.apply_lines(kind, run_.id, applied):
            print(line)
    for line in report.warning_lines(kind, run_.id, applied, finished, adapter.errors):
        print(line)
    for line in report.final_lines(kind, run_.id, applied, finished, dry=options.dry_run):
        print(line)
    return Outcome(final=report.code(final), run=run_.id, applied=applied, finished=finished)


def anonymized(record):
    """A member record with fake personal fields; records with a problem
    carry none and are staged as they are."""
    data = record.get('data') or {}
    if 'problem' in data:
        return record
    return {**record, 'data': anonymize(record['external_id'], data)}
