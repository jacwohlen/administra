/**
 * The OpenAPI 3.1 description of Alleda's API for other systems
 * (docs/API.md), served at /api/v1/openapi.json and shown with Scalar at
 * /api/docs, where a key can be tried against the instance itself.
 *
 * A new endpoint under /api/v1/ adds its path, its scope (SCOPE_TEXT) and
 * its schemas here; openApi.test.ts checks that every scope in API_SCOPES
 * and every route under src/routes/api/v1/ is described.
 */

import { API_SCOPES, DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS, type ApiScope } from './publicApi';

/** What each scope gives, shown with the authentication */
const SCOPE_TEXT: Record<ApiScope, string> = {
  'training_plan:read':
    '`GET /api/v1/training-plan`: planned trainings, dates, who leads, topic, cancellations, holidays'
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

**Caching.** Answers may be kept for five minutes
(\`Cache-Control: private, max-age=300\`), by browsers and the website's
server, not by shared caches.`;

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
