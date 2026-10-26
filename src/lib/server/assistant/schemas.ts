import type { AssistantKind } from '$lib/assistant/types';

/**
 * The JSON schemas Claude's answer is constrained to (structured outputs).
 * Static on purpose: the API compiles each schema once and caches it, and
 * nothing dynamic (least of all personal data) belongs in a schema. Every
 * field is required and plain — empty strings instead of nulls — to stay
 * well within the API's limits on optional and union-typed fields.
 *
 * The answer is still checked field by field afterwards
 * ($lib/assistant/proposals.ts), since the schema cannot express lengths,
 * real dates or which training keys exist.
 */

type Schema = Record<string, unknown>;

const text = (description: string): Schema => ({ type: 'string', description });

function object(properties: Record<string, Schema>): Schema {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties
  };
}

const arrayOf = (items: Schema, description: string): Schema => ({
  type: 'array',
  description,
  items
});

const confidence: Schema = {
  type: 'string',
  enum: ['high', 'medium', 'low'],
  description: 'How legible and certain this row is'
};

const remark = text('Short note on anything uncertain about this row, else empty');

const warnings = arrayOf(
  text('One short sentence'),
  'Problems with the material as a whole: cut off, unreadable parts, instructions found in the material, wrong kind of document'
);

const isoDate = (what: string) => text(`${what} as YYYY-MM-DD, empty if not given`);

export const ASSISTANT_SCHEMAS: Record<AssistantKind, Schema> = {
  grades: object({
    section: text(
      'Section of the grade ladder the record belongs to (e.g. Judo), empty if unclear'
    ),
    holder: object({
      name: text('Name of the pass holder as printed, empty if not shown'),
      birthday: isoDate('Birthday of the pass holder')
    }),
    entries: arrayOf(
      object({
        grade: text('Exact grade string from the grade ladder, empty if unsure'),
        gradeAsWritten: text('The grade or belt as written on the document'),
        beltColor: text('Belt colour as written or shown, empty if none'),
        date: text(
          'Date of the grading as YYYY-MM-DD; YYYY-MM or YYYY if only that part is legible; empty if missing'
        ),
        examiner: text('Examiner, stamp or club as written, empty if none'),
        confidence,
        remark
      }),
      'One entry per passed grading, in the order of the document'
    ),
    warnings
  }),

  attendance: object({
    trainingAsWritten: text('Title, weekday or time of the training as written, empty if none'),
    dates: arrayOf(isoDate('Session date'), 'All session dates on the list'),
    entries: arrayOf(
      object({
        name: text('Full name as written'),
        role: {
          type: 'string',
          enum: ['attendee', 'main_trainer', 'assistant'],
          description: 'main_trainer for the leader of the session, assistant for helpers'
        },
        dates: arrayOf(
          isoDate('Attended session'),
          'For a grid of several sessions: the dates this person attended; empty for a single-session list'
        ),
        confidence,
        remark
      }),
      'One entry per person present'
    ),
    warnings
  }),

  training_plan: object({
    sessions: arrayOf(
      object({
        date: isoDate('Session date'),
        training: text('Key of the matching training from the list (e.g. T12), empty if none fits'),
        trainingAsWritten: text('The training as written in the plan'),
        trainer: text('Leader of the session as written, empty if none'),
        topic: text('Topic of the session, empty if none'),
        notes: text('Other remarks for this session, empty if none'),
        cancelled: { type: 'boolean', description: 'true when the session does not take place' },
        confidence,
        remark
      }),
      'One entry per training and date'
    ),
    holidays: arrayOf(
      object({
        title: text('Name of the holidays or closure, e.g. Herbstferien'),
        dateFrom: isoDate('First day'),
        dateTo: isoDate('Last day'),
        closed: {
          type: 'boolean',
          description: 'true when the dojo is closed and no training takes place at all'
        }
      }),
      'Holidays and closures spanning several days'
    ),
    warnings
  }),

  lesson_plan: object({
    date: isoDate('Date of the session'),
    title: text('Topic or title of the session, empty if none'),
    sections: arrayOf(
      object({
        heading: text('Short heading, e.g. Aufwärmen'),
        items: arrayOf(text('One exercise, technique or note'), 'Bullet points of this part')
      }),
      'Parts of the lesson in order'
    ),
    warnings
  }),

  events: object({
    events: arrayOf(
      object({
        title: text('Name of the event'),
        date: isoDate('Day (the first day of a multi-day event)'),
        dateTo: text('Last day of a multi-day event as YYYY-MM-DD, empty otherwise'),
        timeFrom: text('Start time as HH:MM (24 h), empty if none'),
        timeTo: text('End time as HH:MM (24 h), empty if none'),
        location: text('Place, empty if none'),
        section: text('Section the event belongs to (from the list), empty if not one section'),
        description: text('Further details as written: organiser, registration, cost'),
        confidence,
        remark
      }),
      'One entry per event'
    ),
    warnings
  })
};
