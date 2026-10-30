#!/usr/bin/env python3
"""Webling sync entry point (the workflow and local runs).

    python src/sync.py members [--dry-run]
    python src/sync.py events [--calendar ID|NAME ...] [--dry-run]
    python src/sync.py list

Every run goes through the integration layer (docs/INTEGRATIONS.md): the
adapter in src/webling_adapter reads Webling, integration_begin, _stage,
_apply and _finish write. A database without the layer is an error (exit
1), never a reason to write some other way.

Further settings (environment): INTEGRATION_DRY_RUN=true (as --dry-run),
INTEGRATION_TRIGGER (schedule|manual), INTEGRATION_RUNNER (github:<run
id>), WEBLING_ACCEPT_GONE / _STATUS_DROP / _STATUS_GAIN / _EVENTS_GONE
(the exact numbers of a refusal), ANONYMIZE (members: true everywhere but
prod), WEBLING_EVENTS_LIST_CALL=false (one call per event only).
See webling-sync/README.md.
"""
import argparse
import os
import sys

# Overrides per kind (environment variable -> apply option)
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
    parser.add_argument('--dry-run', action='store_true',
                        help='write nothing (the layer says what it would do)')
    return parser.parse_args(argv)


def env(name):
    return (os.environ.get(name) or '').strip()


def accept_options(kind):
    """{option: n} for the overrides set (digits only)."""
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
    """members: ANONYMIZE must be true or false (no default: a forgotten
    setting must stop the run, not leak real data or overwrite prod)."""
    from integration.runner import ConfigError
    if kind != 'members':
        return False
    value = env('ANONYMIZE')
    if value not in ('true', 'false'):
        raise ConfigError('Please export ANONYMIZE=true (dev/staging) or ANONYMIZE=false (prod only)')
    return value == 'true'


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    dry_run = args.dry_run or env('INTEGRATION_DRY_RUN').lower() == 'true'
    if args.calendar and args.kind != 'events':
        print('Error: --calendar is for events only')
        return 2
    from integration import runner
    if args.kind == 'list':
        return list_calendars(args.calendar)
    try:
        anonymize = anonymize_setting(args.kind)
    except runner.ConfigError as err:
        print(f"Error: {err}")
        return 1
    options = runner.Options(
        kind=args.kind, dry_run=dry_run,
        trigger=env('INTEGRATION_TRIGGER') if env('INTEGRATION_TRIGGER') in ('schedule', 'manual') else 'manual',
        runner=env('INTEGRATION_RUNNER') or None,
        accept=accept_options(args.kind), anonymize=anonymize)
    return runner.run(options, adapter=lambda: make_adapter(args.kind, args.calendar), layer=make_layer)


def list_calendars(calendars):
    from integration.runner import ConfigError
    from webling_adapter.api import WeblingError
    try:
        adapter = make_adapter('list', calendars)
        print('Available calendars:')
        return adapter.list_calendars()
    except (ConfigError, WeblingError) as err:
        print(f"Error: {err}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
