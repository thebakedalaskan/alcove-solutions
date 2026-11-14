/*
 * Checks the judge before an eval leans on it: `pnpm --filter @alcove/server eval:notes:judge-check [--case ID]`. It
 * needs only an Anthropic API key (the notes model isn't used). Each case is graded once alone and then once for every
 * never item at the same time, so the others read the case from the judge's cache: a couple of cents a short case,
 * about fifteen cents a long one. The held-back cases (heldout.ts) are checked too, with their plants from their file;
 * their verdicts go beside it, and only how many were right is printed.
 *
 * The judge grades notes whose right verdict is known:
 *  - the answer key: each case's expected items, word for word, in their own lists, with the expected owners and due
 *    dates (the Spanish call's in Spanish). Every item must match its own expected item, no due date may be called
 *    different, nothing may be called a repeat, nothing on the never list may be flagged, and the language must be right.
 *  - the answer key with one never item planted in it, once for every never item: that item must be flagged.
 * Notes this close to the answer key show the judge is wired up and reads the never list, not that it grades real notes
 * as a person would. That takes reading its verdicts on real notes and marking where you'd disagree (label-cli.ts).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { errorMessage, type TranscriptLine } from '@alcove/api';
import { lineAt, linesOf, problemsIn } from './brief';
import type { EvalCase } from './cases';
import { EVERY_CASE, HELD, HELDOUT_RUNS, isHeld } from './heldout';
import { expectedOf, judge, judgeCost, JUDGE, type Judged, type JudgeExchange, type Kind, type NoteItem, type NoteProse } from './judge';
import { PLANTS, type Plant } from './plants';

const plantsOf = (c: EvalCase): Plant[] => PLANTS[c.id] ?? HELD.plants[c.id] ?? [];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const say = (text: string) => { process.stdout.write(text); };

const args = parseArgs({
  options: {
    case: { type: 'string', multiple: true },
    out: { type: 'string', default: join(ROOT, '.evals', 'notes-judge-check') }
  }
}).values;

/** A case's expected items as notes in its own language would put them, by expected label, for cases not in English. */
const IN_CASE_LANGUAGE: Record<string, Record<string, { text: string; due: string | null }>> = {
  'spanish-call': {
    E1: { text: 'Ir a la feria de Guadalajara', due: null },
    E2: { text: 'Quién va a estar en el stand y si hay que contratar a alguien', due: null },
    E3: { text: 'Reservar el stand', due: 'mañana' },
    E4: { text: 'Preparar las muestras del catálogo nuevo', due: null }
  }
};

/** A note item before it's labelled, with the expected item it states (null for one planted). */
interface Draft { expected: string | null; item: Omit<NoteItem, 'id'> }
const ORDER: Kind[] = ['decision', 'question', 'action'];
const LABEL: Record<Kind, string> = { decision: 'D', question: 'Q', action: 'F' };
const NO_PROSE: NoteProse = { summary: '', chapters: [] };

function answerKey(c: EvalCase, lines: TranscriptLine[], inCaseLanguage: boolean): Draft[] {
  const own = inCaseLanguage ? IN_CASE_LANGUAGE[c.id] : undefined;
  return expectedOf(c).map((e) => {
    const t = own?.[e.id];
    return { expected: e.id, item: { kind: e.kind, text: t?.text ?? e.what, owner: e.owner, due: t ? t.due : e.due, lines: [lineAt(lines, e.at)] } };
  });
}

function planted(c: EvalCase, lines: TranscriptLine[], p: Plant): { drafts: Draft[]; prose: NoteProse } {
  const drafts = answerKey(c, lines, p.plant !== 'english');
  switch (p.plant) {
    case 'summary': return { drafts, prose: { summary: p.text, chapters: [] } };
    case 'item': return { drafts: [...drafts, { expected: null, item: { kind: p.kind, text: p.text, owner: p.owner, due: p.due, lines: [] } }], prose: NO_PROSE };
    case 'english': return { drafts, prose: NO_PROSE };
    case 'change': {
      if (!drafts.some((d) => d.expected === p.of)) throw new Error(`${c.id}: no expected item ${p.of} to change`);
      const changed = drafts.map((d) => (d.expected !== p.of ? d : { ...d, item: { ...d.item, ...(p.owner === undefined ? {} : { owner: p.owner }), ...(p.due === undefined ? {} : { due: p.due }) } }));
      return { drafts: changed, prose: NO_PROSE };
    }
  }
}

/** Labels note items as the eval does (D1, D2…, then Q…, then F…), with the expected item each should match. */
function labelled(drafts: Draft[]): { items: NoteItem[]; wanted: Map<string, string | null> } {
  const items: NoteItem[] = [];
  const wanted = new Map<string, string | null>();
  for (const kind of ORDER) {
    drafts.filter((d) => d.item.kind === kind).forEach((d, i) => {
      const id = `${LABEL[kind]}${i + 1}`;
      items.push({ id, ...d.item });
      wanted.set(id, d.expected);
    });
  }
  return { items, wanted };
}

/** Where the judge's verdict on the answer key differs from the right one. */
function answerKeyMisses(items: NoteItem[], wanted: Map<string, string | null>, judged: Judged): string[] {
  if (!judged.ok) return [`no verdict: ${judged.error}`];
  const v = judged.verdict;
  return [
    ...items.flatMap((item) => {
      const got = v.items.find((x) => x.id === item.id);
      if (!got) return [`${item.id}: no verdict on it`];
      const want = wanted.get(item.id) ?? null;
      return [
        ...(got.match === want ? [] : [`${item.id} "${item.text}" matched to ${got.match ?? 'nothing'}, not ${want ?? 'nothing'} (${got.reason ?? 'no reason given'})`]),
        ...(got.same_as ? [`${item.id} called a repeat of ${got.same_as}`] : []),
        ...(item.kind === 'action' && got.due_ok !== true ? [`${item.id}'s due date "${item.due ?? 'none'}" called different (${got.reason ?? 'no reason given'})`] : [])
      ];
    }),
    ...v.never.filter((n) => n.violated).map((n) => `${n.id} flagged though nothing breaks it (${n.reason ?? 'no reason given'})`),
    ...(v.language_ok ? [] : ['the language called wrong'])
  ];
}

/** Whether the judge flagged the never item planted, and what else it flagged. */
function plantMisses(n: number, p: Plant, judged: Judged): { misses: string[]; alsoFlagged: string[] } {
  if (!judged.ok) return { misses: [`no verdict: ${judged.error}`], alsoFlagged: [] };
  const v = judged.verdict;
  const id = `N${n + 1}`;
  return {
    misses: [
      ...(v.never.find((x) => x.id === id)?.violated === true ? [] : [`${id} not flagged`]),
      ...(p.plant === 'english' && v.language_ok ? ['the language called right'] : [])
    ],
    alsoFlagged: v.never.filter((x) => x.violated && x.id !== id).map((x) => x.id)
  };
}

async function main(): Promise<void> {
  const chosen = args.case?.length ? EVERY_CASE.filter((c) => args.case?.includes(c.id)) : EVERY_CASE;
  const unknown = (args.case ?? []).filter((id) => !EVERY_CASE.some((c) => c.id === id));
  if (unknown.length) throw new Error(`no such case: ${unknown.join(', ')}`);
  // A case and what's planted in it falling out of step would score the judge wrong, so that's found before anything is sent.
  const problems = [
    ...chosen.flatMap(problemsIn),
    ...chosen.flatMap((c) => (plantsOf(c).length === c.expect.never.length ? [] : [`${c.id}: ${c.expect.never.length} never items but ${plantsOf(c).length} planted`])),
    ...chosen.flatMap((c) => (c.writtenIn === 'en' ? [] : expectedOf(c).filter((e) => !IN_CASE_LANGUAGE[c.id]?.[e.id]).map((e) => `${c.id}: ${e.id} has no ${c.writtenIn} wording`)))
  ];
  if (problems.length) throw new Error(`fix these first:\n${problems.join('\n')}`);

  const client = new Anthropic();
  const folder = join(args.out, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  const gradings = chosen.reduce((n, c) => n + 1 + c.expect.never.length, 0);
  say(`Judge check: ${chosen.length} case${chosen.length === 1 ? '' : 's'}, ${gradings} gradings by ${JUDGE.model} at ${JUDGE.effort} effort.\n\n`);

  let agreed = 0;
  const exchanges: JudgeExchange[] = [];
  for (const c of chosen) {
    const lines = linesOf(c);
    const dir = isHeld(c.id) ? join(HELDOUT_RUNS, 'judge-check', basename(folder), c.id) : join(folder, c.id);
    const variants = [
      { name: 'answer-key', drafts: answerKey(c, lines, true), prose: NO_PROSE, plant: null },
      ...plantsOf(c).map((p, n) => ({ name: `N${n + 1}`, ...planted(c, lines, p), plant: { n, p } }))
    ];
    const grade = async (v: (typeof variants)[number]) => {
      const { items, wanted } = labelled(v.drafts);
      const judged = await judge(client, c, lines, items, v.prose);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${v.name}.json`), JSON.stringify({ notes: { items, prose: v.prose }, judged }, null, 2));
      return { v, items, wanted, judged };
    };
    // The first grading writes the case to the judge's cache; the rest, sent after it, read it back.
    const [first, ...rest] = variants;
    const results = first ? [await grade(first), ...(await Promise.all(rest.map(grade)))] : [];
    let right = 0;
    const said: string[] = [];
    for (const { v, items, wanted, judged } of results) {
      if (judged.exchange) exchanges.push(judged.exchange);
      if (!v.plant) {
        const misses = answerKeyMisses(items, wanted, judged);
        if (!misses.length) right++;
        const how = !judged.ok ? `no verdict (${judged.error})` : misses.length ? `${misses.length} wrong` : 'right';
        said.push(`  answer key: ${how}\n${judged.ok ? misses.map((m) => `    - ${m}\n`).join('') : ''}`);
        continue;
      }
      const { misses, alsoFlagged } = plantMisses(v.plant.n, v.plant.p, judged);
      if (!misses.length) right++;
      const how = !judged.ok ? `no verdict (${judged.error})` : misses.length ? `missed (${misses.join('; ')})` : 'caught';
      said.push(`  ${v.name} planted: ${how}${alsoFlagged.length ? `; also flagged ${alsoFlagged.join(', ')}` : ''}\n`);
    }
    agreed += right;
    // What went wrong with a held-back case would say what it expects, so only the count is printed.
    say(isHeld(c.id) ? `${c.id} (held back): ${right} of ${results.length} right\n` : `${c.id}\n${said.join('')}`);
  }
  const outTokens = exchanges.reduce((a, x) => a + x.outputTokens, 0);
  const tokens = (pick: (x: JudgeExchange) => number) => exchanges.reduce((a, x) => a + pick(x), 0);
  say(`\n${agreed} of ${gradings} gradings right. Judge tokens: ${tokens((x) => x.inputTokens)} in, ${tokens((x) => x.cacheWriteTokens)} written to the cache, ${tokens((x) => x.cacheReadTokens)} read from it, ${outTokens} out (about ${Math.round(outTokens / gradings)} out per grading); about $${judgeCost(exchanges).toFixed(2)}.\n`);
  say(`Every request and verdict is in ${folder}${chosen.some((c) => isHeld(c.id)) ? `, the held-back cases' in ${join(HELDOUT_RUNS, 'judge-check', basename(folder))}` : ''}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${errorMessage(e)}\n`); process.exitCode = 1; });
