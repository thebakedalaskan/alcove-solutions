/*
 * What backs an entry in the notes (docs: Notes and inference › Decisions and follow-ups). An entry keeps which lines it
 * rests on, and that's all it keeps: the words, who said them and what's in doubt about them are read from the note each
 * time someone reads it, under the check that gave them the note. So a line corrected since shows as corrected, a reader
 * who lost the note gets nothing, and nothing derived is stored for anyone.
 */
import type { Decision, NoteAction, NoteDecision, NoteEvidence, NoteEvidenceFlag, NoteEvidenceMoment, NoteQuestion, NoteRoom, ScreenMoment, TranscriptLine } from '@alcove/api';
import type { NoteManifest } from './notes';

/** What a decision, an open question and a follow-up have in common here. */
type Entry = Pick<Decision, 'at' | 'screen' | 'lines' | 'against' | 'changes'> & { disputes?: Decision['disputes'] };

/** How far from an entry's moment a line can be and still be what it points at, for entries from before they kept their lines. */
const NEAR_SECONDS = 20;

/** The line said nearest a moment, if one was said near it. */
function lineAt(lines: TranscriptLine[], at: number): TranscriptLine | undefined {
  let best: TranscriptLine | undefined;
  for (const l of lines) if (Math.abs(l.at - at) <= NEAR_SECONDS && (!best || Math.abs(l.at - at) < Math.abs(best.at - at))) best = l;
  return best;
}

/** Whether a line's words or speaker changed after a moment. Saying it was heard right changes neither. */
const changedSince = (l: TranscriptLine, since: string) => (l.changes ?? []).some((c) => c.what !== 'confirmed' && c.at > since);

function evidenceOf(e: Entry, part: TranscriptLine[], lines: Map<string, TranscriptLine>, screens: ScreenMoment[], writtenAt: string | null): NoteEvidence {
  // Whoever last settled an entry read the lines as they were then; an entry nobody touched is as the notes read them.
  const since = e.changes.at(-1)?.at ?? writtenAt ?? '';
  const found = (ids: string[]) => ids.flatMap((id) => { const l = lines.get(id); return l ? [l] : []; });
  const named = found(e.lines);
  // An entry from before entries kept their lines points at a moment, as it always did.
  const near = !named.length && e.at !== undefined ? lineAt(part, e.at) : undefined;
  const behind = near ? [near] : named;
  const against = found(e.against);
  const line = (l: TranscriptLine, cuts: boolean): NoteEvidenceMoment => ({
    kind: 'line', id: l.id, at: l.at, ...(l.speaker ? { speaker: l.speaker } : {}), text: l.text, against: cuts, corrected: changedSince(l, since), ...(l.unsure ? { unsure: l.unsure } : {})
  });
  const ref = e.screen;
  const shown = ref && screens.find((m) => m.id === ref.id);
  const label = shown && ref?.region !== undefined ? shown.regions[ref.region]?.label : undefined;
  const moments: NoteEvidenceMoment[] = [...behind.map((l) => line(l, false)), ...against.map((l) => line(l, true))];
  if (shown && ref) moments.push({ kind: 'screen', id: shown.id, at: shown.at, title: shown.title, ...(ref.region === undefined ? {} : { region: ref.region }), ...(label ? { part: label } : {}), sure: ref.sure });

  const flags: NoteEvidenceFlag[] = [];
  if (!behind.length && !shown) flags.push('missing');
  if (against.length || e.disputes?.length) flags.push('conflict');
  if (behind.length && behind.every((l) => l.unsure) && !ref?.sure) flags.push('unsure');
  if (behind.some((l) => changedSince(l, since))) flags.push('corrected');
  return { moments, flags };
}

/** A note's decisions, open questions and follow-ups for someone reading it now, the call's and each room's, each with what backs it. */
export function entriesOf(m: NoteManifest): { decisions: NoteDecision[]; questions: NoteQuestion[]; actions: NoteAction[]; rooms: NoteRoom[] } {
  const main = m.transcript ?? [];
  const lines = new Map([...main, ...m.rooms.flatMap((r) => r.transcript)].map((l) => [l.id, l]));
  const back = <T extends Entry>(xs: T[], part: TranscriptLine[]) => xs.map((x) => ({ ...x, evidence: evidenceOf(x, part, lines, m.screens, m.writtenAt) }));
  return {
    decisions: back(m.decisions, main), questions: back(m.questions, main), actions: back(m.actions, main),
    rooms: m.rooms.map((r) => ({ ...r, decisions: back(r.decisions, r.transcript), questions: back(r.questions, r.transcript), actions: back(r.actions, r.transcript) }))
  };
}
