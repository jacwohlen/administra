#!/usr/bin/env python3
"""Webling sync entry point (the workflow and local runs).

    python src/sync.py members [--dry-run] [--mode legacy|shadow|layer]
    python src/sync.py events [--calendar ID|NAME ...] [--dry-run] [--mode ...]
    python src/sync.py list

The mode comes from --mode, else INTEGRATION_MODE, else legacy (also when
it is set but empty):
    legacy  runs today's scripts unchanged (src/webling.py, src/events.py),
            in their own process, with their exit status
    shadow  legacy, then the same fetch as a dry run of the integration
            layer (nothing written through it; its result is only logged)
    layer   the integration layer (docs/INTEGRATIONS.md); falls back to
            legacy only while the database has no integration_begin

Further settings (environment): INTEGRATION_DRY_RUN=true (as --dry-run),
INTEGRATION_TRIGGER (schedule|manual), INTEGRATION_RUNNER (github:<run
id>), WEBLING_ACCEPT_GONE / _STATUS_DROP / _STATUS_GAIN / _EVENTS_GONE
(the exact numbers of a refusal), ANONYMIZE (members: true everywhere but
prod), WEBLING_EVENTS_LIST_CALL=false (one call per event only).
See webling-sync/README.md.
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent

# Overrides per kind (environment variable -> apply option); the legacy
# scripts read the first two themselves
ACCEPT = {
    'members': {'WEBLING_ACCEPT_GONE': 'accept_gone',
                'WEBLING_ACCEPT_STATUS_DROP': 'accept_status_drop',
                'WEBLING_ACCEPT_STATUS_GAIN': 'accept_status_gain'},
    'events': {'WEBLING_ACCEPT_EVENTS_GONE': 'accept_events_gone'},
}


def parse_args(argv):
    parser = argparse.ArgumentParser(prog='sync.py', description='Webling sync (see README.md)')
    parser.add_argument('kind', choices=['members', 'events', 'list'])
    parser.add_argument('--calendar', nargs='+', default=[], metavar='ID|NAME',
                        help='events only: calendars by id or part of the name')
    parser.add_argument('--dry-run', action='store_true', help='layer only: write nothing')
    parser.add_argument('--mode', help='legacy, shadow or layer (default: INTEGRATION_MODE, else legacy)')
    return parser.parse_args(argv)


def env(name):
    return (os.environ.get(name) or '').strip()


def legacy_command(kind, calendars):
    """The legacy script and its arguments, as the workflow ran it before."""
    if kind == 'members':
        return [sys.executable, str(SRC / 'webling.py')]
    if kind == 'list':
        return [sys.executable, str(SRC / 'events.py'), 'list']
    return [sys.executable, str(SRC / 'events.py'), *(['--calendar', *calendars] if calendars else [])]


def run_legacy(command):
    """Runs a legacy script in its own process (exactly as before: its
    environment checks, output and exit status). Returns its exit status."""
    sys.stdout.flush()
    status = subprocess.run(command).returncode
    return status if status >= 0 else 1


def accept_options(kind):
    """{option: n} for the overrides set (digits only, as the legacy scripts)."""
    return {option: int(env(name)) for name, option in ACCEPT.get(kind, {}).items()
            if env(name).isdigit()}


def required(name, hint=''):
    from integration.runner import ConfigError
    value = env(name)
    if not value:
        raise ConfigError(f"Please export {name}{hint}")
    return value


def make_adapter(kind, calendars):
    from webling_adapter import WeblingAdapter
    domain = required('WEBLING_DOMAIN')
    api_key = required('WEBLING_API_KEY')
    email = password = None
    if kind == 'events':
        email = required('WEBLING_EMAIL', ' (for participant API authentication)')
        password = required('WEBLING_PASSWORD', ' (for participant API authentication)')
    return WeblingAdapter(domain, api_key, email, password, selectors=calendars,
                          list_call=env('WEBLING_EVENTS_LIST_CALL').lower() != 'false')


def make_layer():
    from integration.client import Client
    from integration.layer import Layer
    url = required('SUPABASE_URL')
    key = required('SUPABASE_SERVICE_ROLE_KEY', ' (the service_role key; RLS blocks the anon key)')
    return Layer(Client(url, key))


def anonymize_setting(kind):
    """members: ANONYMIZE must be true or false, as for webling.py (no
    default: a forgotten setting must stop the run, not leak real data or
    overwrite prod)."""
    from integration.runner import ConfigError
    if kind != 'members':
        return False
    value = env('ANONYMIZE')
    if value not in ('true', 'false'):
        raise ConfigError('Please export ANONYMIZE=true (dev/staging) or ANONYMIZE=false (prod only)')
    return value == 'true'


def main(argv=None, legacy=run_legacy):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    mode = (args.mode or env('INTEGRATION_MODE') or 'legacy').strip().lower()
    dry_run = args.dry_run or env('INTEGRATION_DRY_RUN').lower() == 'true'
    if args.calendar and args.kind != 'events':
        print('Error: --calendar is for events only')
        return 2

    def run_legacy_kind():
        return legacy(legacy_command(args.kind, args.calendar))

    if mode == 'legacy' and not dry_run:
        # Nothing of the layer is imported: this is the scheduled prod path
        # until INTEGRATION_MODE is set
        print('Mode: legacy')
        return run_legacy_kind()

    from integration import runner
    if args.kind == 'list':
        if mode not in runner.MODES:
            print(f"Error: unknown mode {mode!r} (legacy, shadow or layer)")
            return 2
        return list_calendars(args.calendar)
    try:
        anonymize = anonymize_setting(args.kind)
    except runner.ConfigError as err:
        print(f"Error: {err}")
        return 1
    options = runner.Options(
        kind=args.kind, mode=mode, dry_run=dry_run,
        trigger=env('INTEGRATION_TRIGGER') if env('INTEGRATION_TRIGGER') in ('schedule', 'manual') else 'manual',
        runner=env('INTEGRATION_RUNNER') or None,
        accept=accept_options(args.kind), anonymize=anonymize)
    return runner.run(options, legacy=run_legacy_kind,
                      adapter=lambda: make_adapter(args.kind, args.calendar), layer=make_layer)


def list_calendars(calendars):
    from integration.runner import ConfigError
    from safe_log import WeblingError
    try:
        adapter = make_adapter('list', calendars)
        print('Available calendars:')
        return adapter.list_calendars()
    except (ConfigError, WeblingError) as err:
        print(f"Error: {err}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
