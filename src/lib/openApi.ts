/**
 * The OpenAPI 3.1 description of Alleda's API for other systems
 * (docs/API.md), served at /api/v1/openapi.json and shown with Scalar at
 * /api/docs, where a key can be tried against the instance itself.
 *
 * A new endpoint under /api/v1/ adds its path, its scope (SCOPE_TEXT) and
 * its schemas here; openApi.test.ts checks that every scope in API_SCOPES
 * and every route under src/routes/api/v1/ is described.
 */

import {
  API_SCOPES,
  DEFAULT_RANGE_DAYS,
  EVENTS_DEFAULT_PAST_DAYS,
  EVENTS_DEFAULT_RANGE_DAYS,
  MAX_RANGE_DAYS,
  type ApiScope
} from './publicApi';

/** What each scope gives, shown with the authentication */
const SCOPE_TEXT: Record<ApiScope, string> = {
  'training_plan:read':
    '`GET /api/v1/training-plan`: planned trainings, dates, who leads, topic, cancellations, holidays',
  'event_participants:read':
    '`GET /api/v1/events`, `GET /api/v1/events/{eventId}/participants`: events with date, place and counts, and per event the names of who took part. Personal data: such a key is for servers only (it lists no websites)',
  'activity_report:read':
    '`GET /api/v1/reports/activity`: the Einsätze report, per person and period the trainings as main trainer and assistant and the coaching days, for the club or one person. Personal data: such a key is for servers only (it lists no websites)'
};

const DATE = { type: 'string', format: 'date', examples: ['2026-11-04'] };
/** Parameters carry no examples: Scalar would fill them in when trying */
const PARAM_DATE = { type: 'string', format: 'date' };
const TIME = {
  type: ['string', 'null'],
  pattern: '^\\d{2}:\\d{2}$',
  description: 'Local time (Europe/Zurich), `HH:MM`; `null` when the training has none',
  examples: ['20:00']
};

const ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'origin_not_allowed',
  'unavailable',
  'not_found'
];

function errorResponse(description: string, code: string, message: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Error' },
        example: { error: { code, message } }
      }
    }
  };
}

const ERRORS = {
  '400': errorResponse(
    'A parameter is malformed, or the period is too long',
    'invalid_request',
    'from must be a date (YYYY-MM-DD)'
  ),
  '401': {
    ...errorResponse(
      'No key, a malformed or unknown one, or one without the scope',
      'unauthorized',
      'An API key is required (Authorization: Bearer).'
    ),
    headers: {
      'WWW-Authenticate': { schema: { type: 'string', examples: ['Bearer realm="alleda"'] } }
    }
  },
  '403': errorResponse(
    'Sent from a website (`Origin`) the key does not list',
    'origin_not_allowed',
    'This API key is not for this website.'
  ),
  '503': errorResponse(
    'The database did not answer; retry later',
    'unavailable',
    'The training plan is temporarily unavailable.'
  )
};

/** The event endpoints: no caching, and every website is refused */
const NO_STORE = {
  description: 'Personal data: never kept',
  schema: { type: 'string', examples: ['no-store'] }
};

const EVENT_ERRORS = {
  ...ERRORS,
  '403': errorResponse(
    'Sent from a website (`Origin`): keys with personal data are for servers only',
    'origin_not_allowed',
    'This API key is for servers only.'
  ),
  '503': errorResponse(
    'The database did not answer; retry later',
    'unavailable',
    'The events are temporarily unavailable.'
  )
};

const DESCRIPTION = `Read Alleda from other systems, for example the club's website.

**Authentication.** Every request sends an API key in the header
\`Authorization: Bearer alleda_…\`, never in the URL. Admins create keys in
Alleda under *Integrationen → API-Schlüssel*; a key is shown once. Each key
reads only what its scopes allow:

${API_SCOPES.map((s) => `- \`${s}\`: ${SCOPE_TEXT[s]}`).join('\n')}

**Trying it here.** Paste a key under *Authentication* and send a request: it
goes from this page straight to this instance, nowhere else, and the key is
not stored.

**Browsers.** A website whose pages fetch in the browser must be listed on
its key (CORS); requests from other websites are refused with \`403\`.
Servers and \`curl\` send no \`Origin\` and are not affected.

**Personal data.** A key with \`event_participants:read\` or
\`activity_report:read\` lists no websites,
so every request from a browser is refused (\`403\`); keep it on the
program's server like a password. Trying it on this page is possible all the
same: it is Alleda's own page, not another website.

**Caching.** Training plan answers may be kept for five minutes
(\`Cache-Control: private, max-age=300\`), by browsers and the website's
server, not by shared caches. Event and report answers are never kept
(\`Cache-Control: no-store\`).`;

/** The OpenAPI document; origin: the instance's, so "Try it" calls it */
export function openApiDocument(origin: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Alleda API',
      version: '1',
      description: DESCRIPTION
    },
    servers: [{ url: `${origin}/api/v1`, description: 'This Alleda instance' }],
    security: [{ apiKey: [] }],
    tags: [
      {
        name: 'Training plan',
        description:
          'Who leads which training on which date, the topic, cancellations and holidays, as on the plan page in Alleda.'
      },
      {
        name: 'Events',
        description:
          'Events and who took part, e.g. for a program writing reports. Personal data: keys for servers only.'
      },
      {
        name: 'Reports',
        description:
          'The Einsätze report as admins see it in Alleda, e.g. for the treasurer. Personal data: keys for servers only.'
      }
    ],
    paths: {
      '/training-plan': {
        get: {
          tags: ['Training plan'],
          operationId: 'getTrainingPlan',
          summary: 'Training plan for a period',
          description: `Every date of every planned training in the period, by date and start time.
Notes, e-mail addresses, member ids and attendance are never in the answer.
Trainers are named as the key says (full name, first name and initial, or not at all).

Scope: \`training_plan:read\`.`,
          parameters: [
            {
              name: 'from',
              in: 'query',
              description: 'First date, `YYYY-MM-DD`. Default: today (Europe/Zurich).',
              schema: PARAM_DATE
            },
            {
              name: 'to',
              in: 'query',
              description: `Last date, inclusive. Default: \`from\` + ${DEFAULT_RANGE_DAYS - 1} days; at most ${MAX_RANGE_DAYS - 1} days after \`from\`.`,
              schema: PARAM_DATE
            },
            {
              name: 'training',
              in: 'query',
              description:
                'Only these trainings: ids separated by commas (see `trainings` in the answer). Default: all planned trainings.',
              schema: { type: 'string', pattern: '^\\d+(,\\d+)*$' }
            }
          ],
          responses: {
            '200': {
              description: 'The plan for the period',
              headers: {
                'Cache-Control': {
                  description: 'May be kept five minutes, not by shared caches',
                  schema: { type: 'string', examples: ['private, max-age=300'] }
                }
              },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TrainingPlan' },
                  example: TRAINING_PLAN_EXAMPLE
                }
              }
            },
            ...ERRORS
          }
        }
      },
      '/events': {
        get: {
          tags: ['Events'],
          operationId: 'listEvents',
          summary: 'Events of a period',
          description: `Every event overlapping the period (a camp that began before \`from\` too), by date and start time, with its counts. Use it to find an event's \`id\`.
The description is never in the answer.

Scope: \`event_participants:read\`.`,
          parameters: [
            {
              name: 'from',
              in: 'query',
              description: `First date, \`YYYY-MM-DD\`. Default: ${EVENTS_DEFAULT_PAST_DAYS} days ago (Europe/Zurich).`,
              schema: PARAM_DATE
            },
            {
              name: 'to',
              in: 'query',
              description: `Last date, inclusive. Default: \`from\` + ${EVENTS_DEFAULT_RANGE_DAYS - 1} days; at most ${MAX_RANGE_DAYS - 1} days after \`from\`.`,
              schema: PARAM_DATE
            }
          ],
          responses: {
            '200': {
              description: 'The events of the period',
              headers: { 'Cache-Control': NO_STORE },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Events' },
                  example: EVENTS_EXAMPLE
                }
              }
            },
            ...EVENT_ERRORS
          }
        }
      },
      '/events/{eventId}/participants': {
        get: {
          tags: ['Events'],
          operationId: 'listEventParticipants',
          summary: 'Who took part in an event',
          description: `Every member registered (not cancelled) or recorded as present, by last and first name.
Only id and name: never e-mail, phone, address, birthday, notes or grades.

Scope: \`event_participants:read\`.`,
          parameters: [
            {
              name: 'eventId',
              in: 'path',
              required: true,
              description: 'The event, `id` from `GET /events`',
              schema: { type: 'integer', minimum: 1 }
            },
            {
              name: 'attended',
              in: 'query',
              description: '`true`: only members recorded as present. Default: `false`, everyone.',
              schema: { type: 'boolean' }
            }
          ],
          responses: {
            '200': {
              description: 'The event and its participants',
              headers: { 'Cache-Control': NO_STORE },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/EventParticipants' },
                  example: { event: EVENTS_EXAMPLE.events[0], participants: PARTICIPANTS_EXAMPLE }
                }
              }
            },
            ...EVENT_ERRORS,
            '404': errorResponse('No event with this id', 'not_found', 'No event with this id.')
          }
        }
      },
      '/reports/activity': {
        get: {
          tags: ['Reports'],
          operationId: 'getActivityReport',
          summary: 'Einsätze report for a period',
          description: `Per person: trainings checked in as main trainer, as assistant, and days coached at events (every event day in the period, a half day 0.5; two events on one day count once). Below, every training held with its trainers, every event with coaches, and planned dates whose check-in shows no main trainer (\`checks\`, not counted).
Computed exactly like the report admins open in Alleda (*Einsätze*) and its PDF, so the numbers match.

With \`member\`: only that person, their counts, the trainings they were a trainer at, the events they coached and the dates planned for them.

Only ids and names: never e-mail, phone, address, birthday or notes.

Scope: \`activity_report:read\`.`,
          parameters: [
            {
              name: 'from',
              in: 'query',
              description:
                'First date, `YYYY-MM-DD`. Default: 1 January of this year (Europe/Zurich).',
              schema: PARAM_DATE
            },
            {
              name: 'to',
              in: 'query',
              description: `Last date, inclusive. Default: 31 December of \`from\`'s year; at most ${MAX_RANGE_DAYS - 1} days after \`from\`.`,
              schema: PARAM_DATE
            },
            {
              name: 'member',
              in: 'query',
              description:
                "One person's report: the member's id (`memberId` in the answer, the Webling id for members from Webling). Default: the whole club.",
              schema: { type: 'integer', minimum: 1 }
            }
          ],
          responses: {
            '200': {
              description: 'The report for the period',
              headers: { 'Cache-Control': NO_STORE },
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ActivityReport' },
                  example: ACTIVITY_REPORT_EXAMPLE
                }
              }
            },
            ...EVENT_ERRORS,
            '503': errorResponse(
              'The database did not answer; retry later',
              'unavailable',
              'The report is temporarily unavailable.'
            ),
            '404': errorResponse('No member with this id', 'not_found', 'No member with this id.')
          }
        }
      }
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'alleda_ and 48 hex characters',
          description: `An API key from *Integrationen → API-Schlüssel*. Scopes:\n\n${API_SCOPES.map((s) => `- \`${s}\``).join('\n')}`
        }
      },
      schemas: {
        TrainingPlan: {
          type: 'object',
          required: ['from', 'to', 'timezone', 'trainings', 'sessions', 'holidays'],
          properties: {
            from: { ...DATE, description: 'First date of the period' },
            to: { ...DATE, description: 'Last date of the period, inclusive' },
            timezone: { type: 'string', const: 'Europe/Zurich' },
            trainings: {
              type: 'array',
              description: 'The trainings in the plan (or the asked ones)',
              items: { $ref: '#/components/schemas/Training' }
            },
            sessions: {
              type: 'array',
              description: 'One per training and date, by date and start time',
              items: { $ref: '#/components/schemas/Session' }
            },
            holidays: {
              type: 'array',
              description: 'Every holiday overlapping the period',
              items: { $ref: '#/components/schemas/Holiday' }
            }
          }
        },
        Training: {
          type: 'object',
          required: ['id', 'title', 'weekday', 'start', 'end', 'section'],
          properties: {
            id: { type: 'integer', examples: [26] },
            title: { type: 'string', examples: ['Judo Randori'] },
            weekday: {
              type: 'string',
              enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            },
            start: TIME,
            end: TIME,
            section: { type: ['string', 'null'], examples: ['Judo'] }
          }
        },
        Session: {
          type: 'object',
          required: [
            'date',
            'trainingId',
            'title',
            'start',
            'end',
            'trainer',
            'topic',
            'cancelled',
            'cancelReason',
            'holiday'
          ],
          properties: {
            date: DATE,
            trainingId: { type: 'integer', examples: [26] },
            title: { type: 'string', examples: ['Judo Randori'] },
            start: TIME,
            end: TIME,
            trainer: {
              type: ['string', 'null'],
              description:
                "Who leads: the planned trainer, else the training's main trainer. `null` when open, or when the key shows no names.",
              examples: ['Anna Muster']
            },
            topic: { type: ['string', 'null'], examples: ['Uchi-mata'] },
            cancelled: {
              type: 'boolean',
              description: 'Dropped, by the planners or by a holiday closing the dojo'
            },
            cancelReason: {
              type: ['string', 'null'],
              description:
                'The title of the holiday closing the dojo; `null` when the planners dropped the date',
              examples: ['Weihnachten']
            },
            holiday: {
              type: ['string', 'null'],
              description:
                'The holiday the training takes place in (school holidays, or a closed dojo the date is held in)',
              examples: ['Herbstferien']
            }
          }
        },
        Holiday: {
          type: 'object',
          required: ['title', 'from', 'to', 'dojoClosed'],
          properties: {
            title: { type: 'string', examples: ['Weihnachten'] },
            from: { ...DATE, description: 'First day' },
            to: { ...DATE, description: 'Last day, inclusive' },
            dojoClosed: {
              type: 'boolean',
              description: 'Planned trainings are dropped, unless a date is held explicitly'
            }
          }
        },
        Events: {
          type: 'object',
          required: ['from', 'to', 'timezone', 'events'],
          properties: {
            from: { ...DATE, description: 'First date of the period' },
            to: { ...DATE, description: 'Last date of the period, inclusive' },
            timezone: { type: 'string', const: 'Europe/Zurich' },
            events: {
              type: 'array',
              description: 'Every event overlapping the period, by date and start time',
              items: { $ref: '#/components/schemas/Event' }
            }
          }
        },
        Event: {
          type: 'object',
          required: [
            'id',
            'title',
            'date',
            'dateTo',
            'allDay',
            'start',
            'end',
            'location',
            'section',
            'registered',
            'attended'
          ],
          properties: {
            id: { type: 'integer', examples: [10000005] },
            title: { type: 'string', examples: ['Sommerlager'] },
            date: { ...DATE, description: 'First day' },
            dateTo: { ...DATE, description: 'Last day, inclusive; the same as `date` for one day' },
            allDay: { type: 'boolean' },
            start: { ...TIME, description: 'Local time `HH:MM`; `null` all day or without a time' },
            end: { ...TIME, description: 'Local time `HH:MM`; `null` all day or without a time' },
            location: { type: ['string', 'null'], examples: ['Tenero'] },
            section: { type: ['string', 'null'], examples: ['Judo'] },
            registered: { type: 'integer', description: 'Registrations not cancelled' },
            attended: { type: 'integer', description: 'Members recorded as present' }
          }
        },
        EventParticipants: {
          type: 'object',
          required: ['event', 'participants'],
          properties: {
            event: { $ref: '#/components/schemas/Event' },
            participants: {
              type: 'array',
              description: 'By last and first name',
              items: { $ref: '#/components/schemas/Participant' }
            }
          }
        },
        Participant: {
          type: 'object',
          required: ['memberId', 'firstname', 'lastname', 'registered', 'attended', 'coach'],
          properties: {
            memberId: {
              type: 'integer',
              description:
                "The member's id in Alleda (the Webling id for members from Webling), to tell two people with the same name apart",
              examples: [4711]
            },
            firstname: { type: 'string', examples: ['Anna'] },
            lastname: { type: 'string', examples: ['Muster'] },
            registered: {
              type: 'boolean',
              description: 'Registered and not cancelled (also when then absent)'
            },
            attended: {
              type: 'boolean',
              description: 'Recorded as present (also without a registration)'
            },
            coach: { type: 'boolean', description: 'Present as coach / leader' }
          }
        },
        Person: {
          type: 'object',
          required: ['memberId', 'firstname', 'lastname'],
          properties: {
            memberId: {
              type: 'integer',
              description: "The member's id in Alleda (the Webling id for members from Webling)",
              examples: [4711]
            },
            firstname: { type: 'string', examples: ['Anna'] },
            lastname: { type: 'string', examples: ['Muster'] }
          }
        },
        ActivityReport: {
          type: 'object',
          required: [
            'from',
            'to',
            'timezone',
            'member',
            'people',
            'totals',
            'trainings',
            'coaching',
            'checks'
          ],
          properties: {
            from: { ...DATE, description: 'First date of the period' },
            to: { ...DATE, description: 'Last date of the period, inclusive' },
            timezone: { type: 'string', const: 'Europe/Zurich' },
            member: {
              oneOf: [{ $ref: '#/components/schemas/Person' }, { type: 'null' }],
              description: 'The person asked for (`member`); `null`: the whole club'
            },
            people: {
              type: 'array',
              description:
                'Everyone with a training or coaching day in the period, by last and first name (with `member`: that person, with zeros when nothing)',
              items: { $ref: '#/components/schemas/ActivityPerson' }
            },
            totals: {
              type: 'object',
              required: ['mainTrainer', 'assistant', 'coachingDays'],
              properties: {
                mainTrainer: { type: 'integer' },
                assistant: { type: 'integer' },
                coachingDays: { type: 'number' }
              }
            },
            trainings: {
              type: 'array',
              description: 'Every training held in the period (with `member`: theirs), by date',
              items: { $ref: '#/components/schemas/ActivityTraining' }
            },
            coaching: {
              type: 'array',
              description:
                'Every event with coaches in the period (with `member`: theirs), by date',
              items: { $ref: '#/components/schemas/ActivityCoaching' }
            },
            checks: {
              type: 'array',
              description:
                'Planned dates up to today, not cancelled, whose check-in shows no main trainer; not counted (with `member`: those planned for them)',
              items: { $ref: '#/components/schemas/ActivityCheck' }
            }
          }
        },
        ActivityPerson: {
          allOf: [
            { $ref: '#/components/schemas/Person' },
            {
              type: 'object',
              required: ['mainTrainer', 'assistant', 'coachingDays'],
              properties: {
                mainTrainer: {
                  type: 'integer',
                  description:
                    'Trainings checked in as main trainer (substitutes count for who came)'
                },
                assistant: { type: 'integer', description: 'Trainings checked in as assistant' },
                coachingDays: {
                  type: 'number',
                  description: 'Days coached at events, a half day 0.5',
                  examples: [2.5]
                }
              }
            }
          ]
        },
        ActivityTraining: {
          type: 'object',
          required: [
            'date',
            'trainingId',
            'title',
            'section',
            'mainTrainers',
            'assistants',
            'participants',
            'lessonPlan'
          ],
          properties: {
            date: DATE,
            trainingId: { type: 'integer', examples: [26] },
            title: { type: 'string', examples: ['Judo Randori'] },
            section: { type: ['string', 'null'], examples: ['Judo'] },
            mainTrainers: { type: 'array', items: { $ref: '#/components/schemas/Person' } },
            assistants: { type: 'array', items: { $ref: '#/components/schemas/Person' } },
            participants: { type: 'integer', description: 'Checked in, without the trainers' },
            lessonPlan: { type: 'boolean', description: 'A lesson plan was written for the date' }
          }
        },
        ActivityCoaching: {
          type: 'object',
          required: ['eventId', 'title', 'from', 'to', 'participants', 'coaches'],
          properties: {
            eventId: { type: 'integer', examples: [10000005] },
            title: { type: 'string', examples: ['Sommerlager'] },
            from: { ...DATE, description: 'First day within the period' },
            to: { ...DATE, description: 'Last day within the period' },
            participants: { type: 'integer', description: 'Checked in, without the coaches' },
            coaches: {
              type: 'array',
              items: {
                allOf: [
                  { $ref: '#/components/schemas/Person' },
                  {
                    type: 'object',
                    required: ['days'],
                    properties: {
                      days: { type: 'number', description: 'Days counted at this event' }
                    }
                  }
                ]
              }
            }
          }
        },
        ActivityCheck: {
          type: 'object',
          required: ['date', 'trainingId', 'title', 'section', 'plannedTrainer', 'reason'],
          properties: {
            date: DATE,
            trainingId: { type: 'integer', examples: [26] },
            title: { type: 'string', examples: ['Judo Randori'] },
            section: { type: ['string', 'null'], examples: ['Judo'] },
            plannedTrainer: {
              oneOf: [{ $ref: '#/components/schemas/Person' }, { type: 'null' }],
              description: 'Who the plan names (after substitutes and swaps); `null` when open'
            },
            reason: {
              type: 'string',
              enum: ['no_main_trainer'],
              description:
                '`no_main_trainer`: held (someone checked in), nobody checked in as main trainer. Dates without any check-in are not listed.'
            }
          }
        },
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: ERROR_CODES },
                message: { type: 'string', description: 'For people; may change' }
              }
            }
          }
        }
      }
    }
  };
}

const TRAINING_PLAN_EXAMPLE = {
  from: '2026-11-02',
  to: '2026-12-31',
  timezone: 'Europe/Zurich',
  trainings: [
    {
      id: 26,
      title: 'Judo Randori',
      weekday: 'Wednesday',
      start: '20:00',
      end: '21:30',
      section: 'Judo'
    }
  ],
  sessions: [
    {
      date: '2026-11-04',
      trainingId: 26,
      title: 'Judo Randori',
      start: '20:00',
      end: '21:30',
      trainer: 'Anna Muster',
      topic: 'Uchi-mata',
      cancelled: false,
      cancelReason: null,
      holiday: null
    },
    {
      date: '2026-12-23',
      trainingId: 26,
      title: 'Judo Randori',
      start: '20:00',
      end: '21:30',
      trainer: 'Anna Muster',
      topic: null,
      cancelled: true,
      cancelReason: 'Weihnachten',
      holiday: null
    }
  ],
  holidays: [{ title: 'Weihnachten', from: '2026-12-21', to: '2027-01-03', dojoClosed: true }]
};

const EVENTS_EXAMPLE = {
  from: '2026-06-01',
  to: '2026-07-31',
  timezone: 'Europe/Zurich',
  events: [
    {
      id: 10000005,
      title: 'Sommerlager',
      date: '2026-07-06',
      dateTo: '2026-07-10',
      allDay: true,
      start: null,
      end: null,
      location: 'Tenero',
      section: 'Judo',
      registered: 24,
      attended: 22
    }
  ]
};

const PARTICIPANTS_EXAMPLE = [
  {
    memberId: 4711,
    firstname: 'Anna',
    lastname: 'Muster',
    registered: true,
    attended: true,
    coach: false
  },
  {
    memberId: 4712,
    firstname: 'Beni',
    lastname: 'Beispiel',
    registered: true,
    attended: false,
    coach: false
  }
];

const ANNA = { memberId: 4711, firstname: 'Anna', lastname: 'Muster' };
const BENI = { memberId: 4712, firstname: 'Beni', lastname: 'Beispiel' };

const ACTIVITY_REPORT_EXAMPLE = {
  from: '2026-01-01',
  to: '2026-12-31',
  timezone: 'Europe/Zurich',
  member: null,
  people: [
    { ...BENI, mainTrainer: 0, assistant: 31, coachingDays: 0.5 },
    { ...ANNA, mainTrainer: 38, assistant: 2, coachingDays: 5 }
  ],
  totals: { mainTrainer: 38, assistant: 33, coachingDays: 5.5 },
  trainings: [
    {
      date: '2026-01-07',
      trainingId: 26,
      title: 'Judo Randori',
      section: 'Judo',
      mainTrainers: [ANNA],
      assistants: [BENI],
      participants: 14,
      lessonPlan: true
    }
  ],
  coaching: [
    {
      eventId: 10000005,
      title: 'Sommerlager',
      from: '2026-07-06',
      to: '2026-07-10',
      participants: 22,
      coaches: [{ ...ANNA, days: 5 }]
    }
  ],
  checks: [
    {
      date: '2026-03-12',
      trainingId: 26,
      title: 'Judo Randori',
      section: 'Judo',
      plannedTrainer: ANNA,
      reason: 'no_main_trainer'
    }
  ]
};
