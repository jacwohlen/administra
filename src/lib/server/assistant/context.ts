import type { SupabaseClient } from '@supabase/supabase-js';
import type { LadderGrade, SanitizeContext } from '$lib/assistant/proposals';
import type { AssistantRequest } from '$lib/assistant/types';
import { loadMailSettings } from '$lib/server/trialMailContext';
import { AssistantError } from './request';

/**
 * Reference data the model needs to map a document onto the club's data:
 * the grade ladder, the training a list belongs to, the planned trainings,
 * the club's sections. Loaded with the caller's session, so it is exactly
 * what the user may read, and never personal data: no member names, no
 * birthdays. Matching names to members happens in the browser.
 */

export interface PromptContext {
  /** Plain text for the <context> block of the prompt */
  text: string;
  /** What the answer is checked against */
  sanitize: SanitizeContext;
}

/** English names for the belt colours of grade_definitions */
const BELT_COLORS: Record<string, string> = {
  '#f5f5f5': 'white',
  '#f4d03f': 'yellow',
  '#f0932b': 'orange',
  '#27ae60': 'green',
  '#2e86de': 'blue',
  '#7b4a2d': 'brown',
  '#111111': 'black'
};

const color = (hex: string | null) => (hex ? (BELT_COLORS[hex.toLowerCase()] ?? hex) : '');

interface GradeRow {
  section: string;
  grade: string;
  gradeRank: number;
  beltColor: string;
  beltColor2: string | null;
}

interface TrainingRow {
  id: number;
  title: string | null;
  weekday: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  section: string | null;
}

const TRAINING_COLUMNS = 'id, title, weekday, dateFrom, dateTo, section';

function describeTraining(t: TrainingRow): string {
  const time = [t.dateFrom, t.dateTo].filter(Boolean).join('–');
  return [t.weekday, time, t.title, t.section ? `(${t.section})` : ''].filter(Boolean).join(' ');
}

async function loadTraining(supabase: SupabaseClient, id: number): Promise<TrainingRow> {
  const { data, error } = await supabase
    .from('trainings')
    .select(TRAINING_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new AssistantError('failed', 500);
  if (!data) throw new AssistantError('not_found', 404);
  return data as TrainingRow;
}

function weekdayOf(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC'
  });
}

const LESSON_HEADINGS = {
  de: 'Aufwärmen, Hauptteil, Ausklang, Notizen',
  en: 'Warm-up, Main part, Cool-down, Notes'
} as const;

export async function loadPromptContext(
  supabase: SupabaseClient,
  request: AssistantRequest
): Promise<PromptContext> {
  const { context } = request;
  switch (request.kind) {
    case 'grades': {
      const { data, error } = await supabase
        .from('grade_definitions')
        .select('section, grade, gradeRank, beltColor, beltColor2')
        .order('section')
        .order('gradeRank');
      if (error) throw new AssistantError('failed', 500);
      const rows = (data ?? []) as GradeRow[];
      const sections = [...new Set(rows.map((r) => r.section))];
      const lines = sections.map((section) => {
        const grades = rows
          .filter((r) => r.section === section)
          .map((r) => {
            const belt = [color(r.beltColor), color(r.beltColor2)].filter(Boolean).join('-');
            return belt ? `${r.grade} (${belt})` : r.grade;
          });
        return `${section}: ${grades.join(', ')}`;
      });
      const ladder: LadderGrade[] = rows.map((r) => ({ section: r.section, grade: r.grade }));
      return {
        text: `<grade_ladder>\n${lines.join('\n')}\n</grade_ladder>`,
        sanitize: { ladder }
      };
    }

    case 'attendance': {
      const training = await loadTraining(supabase, context.trainingId!);
      const lines = [`Training: ${describeTraining(training)}`];
      if (context.date) {
        lines.push(`Session date chosen by the user: ${context.date} (${weekdayOf(context.date)})`);
      }
      return { text: lines.join('\n'), sanitize: {} };
    }

    case 'training_plan': {
      const { data, error } = await supabase
        .from('training_plan_trainings')
        .select(`training:trainings (${TRAINING_COLUMNS})`);
      if (error) throw new AssistantError('failed', 500);
      const trainings = (data ?? [])
        .map((row) => (row as unknown as { training: TrainingRow | null }).training)
        .filter((t): t is TrainingRow => t != null)
        .sort((a, b) => a.id - b.id);
      if (trainings.length === 0) throw new AssistantError('not_found', 404);
      const trainingKeys = new Map(trainings.map((t) => [`T${t.id}`, t.id]));
      const lines = trainings.map((t) => `T${t.id}: ${describeTraining(t)}`);
      return {
        text: `<trainings>\n${lines.join('\n')}\n</trainings>`,
        sanitize: { trainingKeys }
      };
    }

    case 'lesson_plan': {
      const training = await loadTraining(supabase, context.trainingId!);
      return {
        text: [
          `Training: ${describeTraining(training)}`,
          `Session date: ${context.date} (${weekdayOf(context.date!)})`,
          `Preferred headings: ${LESSON_HEADINGS[request.locale]}`
        ].join('\n'),
        sanitize: {}
      };
    }

    case 'events': {
      const { club } = await loadMailSettings(supabase);
      return { text: `Club sections: ${club.sections.join(', ')}`, sanitize: {} };
    }
  }
}

/** Today in the club's time zone, YYYY-MM-DD. */
export function clubToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(now);
}
