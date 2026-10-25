/**
 * Matches a name as written on a list or a pass ("Müller Lena", "L. Mueller",
 * "Beni") to club members. Runs in the browser against the members the user
 * can read; the model never sees the member list and never picks an id.
 *
 * Scores are 0–1. `bestMatch` only accepts a member on its own when the
 * name is clearly theirs; everything else is left for the user to pick
 * from the ranked candidates.
 */

export interface MatchableMember {
  id: number;
  firstname: string;
  lastname: string;
}

export interface MemberMatch<M extends MatchableMember = MatchableMember> {
  member: M;
  score: number;
}

/** Lowercase, without accents, umlauts folded (ü/ue → u), ß → ss. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words of a name; double names ("Anna-Lena") count as one word and as their parts. */
function words(value: string): string[] {
  const out: string[] = [];
  for (const word of normalizeName(value).split(/[\s,]+/)) {
    const w = word.replace(/^[.-]+|-+$/g, '');
    if (!w) continue;
    out.push(w);
    if (w.includes('-')) out.push(...w.split('-').filter(Boolean));
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How well one written word fits one name word, 0–1. First names also
 * match by their first three letters, like matchLeader in
 * $lib/trainingPlanImport ("Beni" for Benjamin, "Roli" for Roland).
 */
function wordScore(written: string, name: string, firstName: boolean): number {
  const w = written.replace(/\.$/, '');
  if (!w) return 0;
  if (w === name) return 1;
  // An initial: "L." or "L"
  if (w.length === 1) return name.startsWith(w) ? 0.85 : 0;
  // A short form: "Chris" for Christian
  if (w.length >= 3 && name.startsWith(w)) return 0.88;
  if (firstName && w.length >= 3 && name.startsWith(w.slice(0, 3))) return 0.8;
  if (w.length < 4 || name.length < 4) return 0;
  // Typos and OCR noise: at most one wrong letter per four
  const distance = levenshtein(w, name);
  const similarity = 1 - distance / Math.max(w.length, name.length);
  return similarity >= 0.75 ? similarity * 0.95 : 0;
}

function best(written: string, names: string[], firstName = false): number {
  return names.reduce((top, name) => Math.max(top, wordScore(written, name, firstName)), 0);
}

/**
 * How well `written` fits the member, 0–1. The last name has to be there
 * unless the list only gives a first name (common on kids' lists), which
 * scores lower so it is never accepted without the user confirming.
 */
export function scoreName(written: string, member: MatchableMember): number {
  const query = words(written);
  if (query.length === 0) return 0;
  const first = words(member.firstname);
  const last = words(member.lastname);
  if (last.length === 0 && first.length === 0) return 0;

  const lastScore = Math.max(0, ...query.map((q) => best(q, last)));
  const firstScore = Math.max(0, ...query.map((q) => best(q, first, true)));

  if (query.length === 1) {
    // A single word: a last name or a first name alone is never certain
    return Math.max(lastScore * 0.7, firstScore * 0.6);
  }
  // A last name was written, but not this member's
  if (lastScore === 0) return firstScore * 0.4;
  // Each written word should belong to the name; extra words cost
  const perWord = query.map((q) => Math.max(best(q, last), best(q, first, true)));
  const covered = perWord.filter((s) => s > 0).length / query.length;
  const score = (lastScore * 0.55 + firstScore * 0.45) * (0.7 + 0.3 * covered);
  return Math.round(score * 1000) / 1000;
}

export interface RankOptions {
  /** Members expected on the list (e.g. the training's roster), preferred on ties */
  preferred?: ReadonlySet<number>;
  limit?: number;
  /** Lowest score worth showing */
  minScore?: number;
}

/** Members that could be meant, best first. */
export function rankMembers<M extends MatchableMember>(
  written: string,
  members: readonly M[],
  { preferred, limit = 5, minScore = 0.45 }: RankOptions = {}
): MemberMatch<M>[] {
  return members
    .map((member) => {
      const score = scoreName(written, member);
      const bonus = score > 0 && preferred?.has(member.id) ? 0.05 : 0;
      return { member, score: Math.min(1, score + bonus) };
    })
    .filter((m) => m.score >= minScore)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.member.lastname.localeCompare(b.member.lastname) ||
        a.member.firstname.localeCompare(b.member.firstname)
    )
    .slice(0, limit);
}

/** Score from which a member is taken without asking */
export const AUTO_MATCH_SCORE = 0.85;
/** Score from which the best candidate is preselected, marked for the user to confirm */
export const SUGGEST_SCORE = 0.55;
/** Lead the best candidate needs over the second */
const AUTO_MATCH_MARGIN = 0.08;

export interface BestMatch<M extends MatchableMember> {
  /** The member taken without asking, null when the user has to pick */
  member: M | null;
  candidates: MemberMatch<M>[];
}

/** The member a name clearly stands for, plus the candidates to choose from. */
export function bestMatch<M extends MatchableMember>(
  written: string,
  members: readonly M[],
  options: RankOptions = {}
): BestMatch<M> {
  const candidates = rankMembers(written, members, options);
  const [top, second] = candidates;
  const clear =
    top &&
    top.score >= AUTO_MATCH_SCORE &&
    (!second || top.score - second.score >= AUTO_MATCH_MARGIN);
  return { member: clear ? top.member : null, candidates };
}
