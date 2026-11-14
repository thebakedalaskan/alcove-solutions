/*
 * A worksheet for checking the judge by hand: `pnpm --filter @alcove/server eval:notes:label <eval> [--size 60]`, where
 * <eval> is an eval folder (a path, or a folder's name under .evals/notes). It writes labels.html into that folder, to
 * open in a browser. Nothing is sent anywhere, so it costs nothing.
 *
 * The judge check (judge-check-cli.ts) shows the judge catches mistakes planted on purpose; this shows whether it grades
 * the notes model's real notes as a person would. The worksheet asks, one at a time, a sample of the questions the judge
 * answered about that eval's notes: which expected item a note item states and whether it repeats an earlier one,
 * whether a follow-up's due date says the same as the expected one, and whether the notes break a never item. You
 * answer before you see the judge's answer, so it can't sway yours. At the end it counts where the two of you differ,
 * and which way: a judge kinder than you inflates the scores, a stricter one deflates them.
 *
 * The sample leans on the calls that move scores most: note items the judge matched to nothing or called a repeat, and
 * never items it found broken, each get a share as big as the far more common calls the other way. No note item is asked
 * about twice, and no never item twice in one case. Long meetings get twice a short one's share, since that's where the
 * judge has most to read. The same eval and size always give the same questions; the page keeps your answers in the
 * browser until you start over, and saves them as a file when you ask.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { errorMessage, type TranscriptLine } from '@alcove/api';
import { z } from 'zod';
import { lineAt, linesOf } from './brief';
import { CASES, type EvalCase } from './cases';
import { expectedOf, Verdict } from './judge';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const PAGE = fileURLToPath(new URL('./label-page.html', import.meta.url));
const say = (text: string) => { process.stdout.write(text); };

const { values: args, positionals } = parseArgs({ options: { size: { type: 'string', default: '60' } }, allowPositionals: true });

/** What the worksheet reads from a run's file (run-cli.ts writes it). */
const RunFile = z.object({
  run: z.number(),
  outcome: z.string(),
  notes: z.object({
    items: z.array(z.object({
      id: z.string(),
      kind: z.enum(['decision', 'question', 'action']),
      text: z.string(),
      owner: z.string().nullable(),
      due: z.string().nullable(),
      lines: z.array(z.number())
    })),
    prose: z.object({ summary: z.string(), chapters: z.array(z.object({ title: z.string(), summary: z.string() })) })
  }),
  judge: z.object({ exchange: z.object({ sent: z.string() }).nullish(), verdict: Verdict.nullish() })
});
type RunFile = z.infer<typeof RunFile>;

/** One judged run of a case as it is now. */
interface Run { c: EvalCase; lines: TranscriptLine[]; run: number; notes: RunFile['notes']; verdict: Verdict }

type Question =
  | { q: 'item'; case: string; run: number; notes: string; item: string; judge: { match: string | null; same_as: string | null; reason: string | null } }
  | { q: 'due'; case: string; run: number; notes: string; item: string; expected: string; judge: { due_ok: boolean; reason: string | null } }
  | { q: 'never'; case: string; run: number; notes: string; never: string; judge: { violated: boolean; where: string | null; reason: string | null } };

type Group = 'astray' | 'matched' | 'due' | 'broken' | 'unbroken';
/** A question the worksheet could ask; `item` is the note item it's about, `never` the never item in its case. */
interface Candidate { group: Group; q: Question; item: string | null; never: string | null }

/** Each group's share of the questions, in the order they're picked; what one can't fill, the others fill in this order. */
const SHARES: [Group, number][] = [['astray', 0.3], ['matched', 0.3], ['due', 0.15], ['broken', 0.15], ['unbroken', 0.1]];
const GROUP_NAMES: Record<Group, string> = {
  astray: 'note items the judge matched to nothing or called a repeat',
  matched: 'note items it matched',
  due: 'due dates',
  broken: 'never items it found broken',
  unbroken: 'never items it found not broken'
};
/** A meeting with more lines than this counts as long, and gets twice the share. */
const LONG_LINES = 200;

const mark = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

async function folderOf(where: string | undefined): Promise<string> {
  if (!where) throw new Error('say which eval: its folder, or the folder\'s name under .evals/notes');
  // pnpm runs this in apps/api, so a relative path is taken from where the command was typed (INIT_CWD).
  const tries = [isAbsolute(where) ? where : resolve(process.env['INIT_CWD'] ?? process.cwd(), where), join(ROOT, '.evals', 'notes', where)];
  const folder = tries.find((f) => existsSync(join(f, 'summary.json')));
  if (!folder) throw new Error(`no summary.json in ${tries.join(' or ')}`);
  return folder;
}

/** Whether a run was judged against the case as it is now, so its labels and line numbers still mean the same. */
function sameCase(c: EvalCase, lines: TranscriptLine[], sent: string): boolean {
  const transcript = sent.split('<transcript>\n')[1]?.split('\n</transcript>')[0] ?? '';
  return transcript.split('\n').length === lines.length
    && expectedOf(c).every((e) => sent.includes(`${e.id} [`) && sent.includes(`] ${e.what}`))
    && c.expect.acceptable.every((a, i) => sent.includes(`A${i + 1} ${a}`))
    && c.expect.never.every((n, i) => sent.includes(`N${i + 1} ${n}`));
}

async function runsIn(folder: string): Promise<{ runs: Run[]; changed: string[] }> {
  const runs: Run[] = [];
  const changed: string[] = [];
  for (const c of CASES) {
    const dir = join(folder, c.id);
    if (!existsSync(dir)) continue;
    const lines = linesOf(c);
    const files = (await readdir(dir)).filter((f) => /^run-\d+\.json$/.test(f));
    let stale = false;
    for (const f of files) {
      const raw: unknown = JSON.parse(await readFile(join(dir, f), 'utf8'));
      const parsed = RunFile.safeParse(raw);
      if (!parsed.success) throw new Error(`${c.id}/${f} isn't a run this version can read: ${parsed.error.issues[0]?.message ?? ''}`);
      const r = parsed.data;
      if (r.outcome !== 'scored' || !r.judge.verdict || !r.judge.exchange) continue;
      if (!sameCase(c, lines, r.judge.exchange.sent)) { stale = true; continue; }
      runs.push({ c, lines, run: r.run, notes: r.notes, verdict: r.judge.verdict });
    }
    if (stale) changed.push(c.id);
  }
  return { runs, changed };
}

function candidatesOf(r: Run): Candidate[] {
  const notes = `${r.c.id}/${r.run}`;
  const expected = expectedOf(r.c);
  const about = { case: r.c.id, run: r.run, notes };
  const out: Candidate[] = [];
  for (const item of r.notes.items) {
    const j = r.verdict.items.find((x) => x.id === item.id);
    if (!j) continue;
    const key = `${notes}/${item.id}`;
    out.push({ group: j.match === null || j.same_as !== null ? 'astray' : 'matched', item: key, never: null, q: { q: 'item', ...about, item: item.id, judge: { match: j.match, same_as: j.same_as, reason: j.reason } } });
    // An expected "none" is decided in code (score.ts), and two dates written the same need no person, so only due
    // dates the judge had to weigh are asked about.
    const e = expected.find((x) => x.id === j.match);
    const written = (s: string | null) => (s ?? '').trim().toLowerCase();
    if (e?.kind === 'action' && e.due !== null && j.due_ok !== null && written(e.due) !== written(item.due)) {
      out.push({ group: 'due', item: key, never: null, q: { q: 'due', ...about, item: item.id, expected: e.id, judge: { due_ok: j.due_ok, reason: j.reason } } });
    }
  }
  for (const n of r.verdict.never) {
    out.push({ group: n.violated ? 'broken' : 'unbroken', item: null, never: `${r.c.id}/${n.id}`, q: { q: 'never', ...about, never: n.id, judge: { violated: n.violated, where: n.where, reason: n.reason } } });
  }
  return out;
}

/** A random number generator that gives the same numbers for the same seed (mulberry32). */
function seeded(seed: string): () => number {
  let a = [...seed].reduce((h, ch) => Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619), 2166136261);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(xs: T[], random: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** Takes each group's share round the cases in turn, long ones twice a round, so no case fills a group by itself. */
function pick(candidates: Candidate[], size: number, seed: string): Candidate[] {
  const turns = CASES.flatMap((c) => (linesOf(c).length > LONG_LINES ? [c.id, c.id] : [c.id]));
  const queues = new Map<string, Candidate[]>();
  for (const x of shuffled(candidates, seeded(seed))) {
    const k = `${x.group}/${x.q.case}`;
    queues.set(k, [...(queues.get(k) ?? []), x]);
  }
  const chosen: Candidate[] = [];
  const items = new Set<string>();
  const nevers = new Set<string>();
  const free = (x: Candidate) => (x.item === null || !items.has(x.item)) && (x.never === null || !nevers.has(x.never));
  const take = (group: Group, want: number) => {
    let got = 0;
    let progress = true;
    while (got < want && progress) {
      progress = false;
      for (const id of turns) {
        if (got >= want) break;
        const queue = queues.get(`${group}/${id}`) ?? [];
        let x = queue.shift();
        while (x && !free(x)) x = queue.shift();
        if (!x) continue;
        chosen.push(x);
        if (x.item !== null) items.add(x.item);
        if (x.never !== null) nevers.add(x.never);
        got++;
        progress = true;
      }
    }
  };
  for (const [group, share] of SHARES) take(group, Math.round(size * share));
  for (const [group] of SHARES) take(group, size - chosen.length);
  return chosen;
}

const ORDER: Record<Question['q'], number> = { item: 0, due: 1, never: 2 };
const labelOf = (q: Question) => (q.q === 'never' ? q.never : q.item);

async function main(): Promise<void> {
  const size = Number(args.size);
  if (!Number.isInteger(size) || size < 1) throw new Error(`--size takes a whole number, not "${args.size ?? ''}"`);
  const folder = await folderOf(positionals[0]);
  const { runs, changed } = await runsIn(folder);
  if (changed.length) say(`Left out, since the case changed after this eval ran: ${changed.join(', ')}\n`);
  if (!runs.length) throw new Error(`no judged runs of the cases as they are now in ${folder}`);

  const chosen = pick(runs.flatMap(candidatesOf), size, `${basename(folder)}:${size}`);
  const caseIndex = (id: string) => CASES.findIndex((c) => c.id === id);
  const questions = chosen.map((x) => x.q).sort((a, b) =>
    caseIndex(a.case) - caseIndex(b.case) || a.run - b.run || ORDER[a.q] - ORDER[b.q] || labelOf(a).localeCompare(labelOf(b), 'en', { numeric: true }));

  const used = runs.filter((r) => questions.some((q) => q.notes === `${r.c.id}/${r.run}`));
  const worksheet = {
    id: `${basename(folder)}:${size}`,
    folder: basename(folder),
    questions,
    cases: Object.fromEntries([...new Map(used.map((r) => [r.c.id, r])).values()].map((r) => [r.c.id, {
      title: r.c.title,
      kind: r.c.kind,
      lines: r.lines.map((l) => ({ t: mark(l.at), who: l.speaker?.name ?? null, text: l.text, unclear: l.unsure?.words === true })),
      expected: expectedOf(r.c).map((e) => ({ id: e.id, kind: e.kind, what: e.what, owner: e.owner, due: e.due, at: lineAt(r.lines, e.at), mark: e.at })),
      acceptable: r.c.expect.acceptable.map((text, i) => ({ id: `A${i + 1}`, text })),
      never: r.c.expect.never.map((text, i) => ({ id: `N${i + 1}`, text }))
    }])),
    notes: Object.fromEntries(used.map((r) => [`${r.c.id}/${r.run}`, r.notes]))
  };

  const page = await readFile(PAGE, 'utf8');
  if (page.split('__WORKSHEET__').length !== 2) throw new Error(`${PAGE} needs __WORKSHEET__ exactly once, where the worksheet goes`);
  // Inside a <script> element, "</script>" in a transcript would end it early; \u003c is the same "<" to JSON.parse.
  const json = JSON.stringify(worksheet).replace(/</g, '\\u003c');
  const out = join(folder, 'labels.html');
  await writeFile(out, page.replace('__WORKSHEET__', () => json));

  const counts = SHARES.map(([group]) => [group, chosen.filter((x) => x.group === group).length] as const).filter(([, n]) => n > 0);
  say(`${questions.length} questions from ${Object.keys(worksheet.cases).length} cases: ${counts.map(([g, n]) => `${n} on ${GROUP_NAMES[g]}`).join(', ')}.\n`);
  say(`Open it in a browser: ${out}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${errorMessage(e)}\n`); process.exitCode = 1; });
