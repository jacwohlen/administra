"""One sync of one kind (members or events) through the integration
layer: begin, stage, apply, finish. A dry run does the same and writes
nothing through it (its run row and new catalog rows aside).

An adapter does the provider's side:
    adapter.connection           the connection id ('webling')
    adapter.plan(kind)           what the run covers, before it opens: an
                                 object with .scope (integration_begin's)
    adapter.empty_scope(kind)    the scope of a run whose plan failed
    adapter.records(plan, run)   the records to stage; run.today,
                                 run.scope and run.settings help
    adapter.errors, .counters    fetch errors and counters for finish
"""
from dataclasses import dataclass, field

from integration import report
from integration.anonymize import anonymize
from integration.layer import LayerError
from integration.safe_log import crash_line


class FetchFailed(Exception):
    """The provider could not be read as a whole (e.g. the member list): no
    record is staged and the run fails. The message is log-safe (method,
    path and status, see integration/safe_log.py)."""


class UsageError(Exception):
    """The run cannot start as asked (e.g. no calendar matched)."""


class ConfigError(Exception):
    """A setting is missing (e.g. an environment variable)."""


@dataclass
class Options:
    kind: str
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


def run(options, adapter, layer):
    """Runs the sync; returns the exit status.

    adapter: () -> the provider adapter
    layer:   () -> integration.layer.Layer
    """
    print(f"Layer {options.kind}{', dry run' if options.dry_run else ''}")
    try:
        outcome = run_layer(options, adapter(), layer())
    except (LayerError, UsageError, ConfigError) as err:
        print(f"Error: {err}")
        return 2 if isinstance(err, UsageError) else 1
    return report.exit_code(outcome.final)


def run_layer(options, adapter, layer):
    """begin, stage, apply, finish. Returns an Outcome; a begin that fails
    (also on a database without the layer) raises LayerError, and nothing
    happened then. finish is always called once the run is open, also when
    the adapter crashes (error 'adapter_crash') or the layer fails mid-run."""
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

    run_ = layer.begin(adapter.connection, kind, scope, dry_run=options.dry_run,
                       trigger=options.trigger, runner=options.runner)
    print(f"Layer {kind} run {run_.id} opened{' (dry run)' if options.dry_run else ''}")
    gone = run_.scope.get('calendars_gone') if isinstance(run_.scope, dict) else None
    if isinstance(gone, list) and gone:
        # Ids only, as everywhere in the log
        print(f"Calendars the provider no longer has (settled as read, without events): "
              f"{', '.join(str(g) for g in gone)}")

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
