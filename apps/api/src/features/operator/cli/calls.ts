/*
 * The operator CLI's commands for calls and notes (features/calls/operator/routes.ts, features/notes/operator/routes.ts):
 * looking a call or a note up, ending a stuck call, closing the room of one that has ended, and retrying a note's writing or
 * its Drive exports. A call or a note is named by its ID, or by an address as pasted: a call's page (/calls/<note id>) or a
 * call ahead (/calls/upcoming/<meeting id>), of which only the ID is kept. A join link (/join/…, /call/…) or a call's code is
 * refused here, before anything is sent: its code lets anyone into the call. An action needs --reason, checked here too, so
 * nothing is sent without one. The answers are parsed with the schemas beside the routes.
 */
import { CallAnswer, CallEndAnswer, RoomCloseAnswer, type CallRunAnswer } from '../../calls/operator/operator';
import { ExportsRetryAnswer, NoteAnswer, NoteRetryAnswer, type JobNow, type NoteLine, type NotesJobAnswer } from '../../notes/operator/operator';
import { aligned, answered, reasonOf, usage, type CliCommand } from './cli';

const warn = (line: string) => { process.stderr.write(`${line}\n`); };

const JOIN_LINK = 'That’s a join link: its code lets anyone in. Ask for the address of the call’s page instead.';
const CODE = 'That’s a call’s code: it lets anyone in. Ask for the address of the call’s page instead.';
const ID = /^[A-Za-z0-9_-]{22}$/;

/** What was typed for a call or a note: its ID, as typed or from an address of a call's page or of a call ahead, or why not. */
type Named = { ok: true; id: string; from: 'id' | 'page' | 'ahead' } | { ok: false; why: string };
function named(typed: string): Named {
  const s = typed.trim();
  if (/\/(?:join|call)\//i.test(s)) return { ok: false, why: JOIN_LINK };
  if (ID.test(s)) return { ok: true, id: s, from: 'id' };
  if (/(?:^|[^a-z])[a-z]{3}-[a-z]{4}-[a-z]{3}(?:$|[^a-z])/.test(s)) return { ok: false, why: CODE };
  const m = /\/calls\/(upcoming\/)?([A-Za-z0-9_-]{22})(?:$|[/?#])/.exec(s);
  const id = m?.[2];
  if (id !== undefined) return { ok: true, id, from: m?.[1] ? 'ahead' : 'page' };
  return { ok: false, why: 'That isn’t an ID, or the address of a call’s page (…/calls/<id>) or of a call ahead (…/calls/upcoming/<id>).' };
}

/**
 * The one ID a command takes, or 2 when it isn't one, said why, with nothing sent. `any`: a call's, a meeting's or a note's;
 * `note`: a note's, so not a call ahead's address; `call`: a call's own ID, which no address holds.
 */
function oneId(args: string[], command: CliCommand, takes: 'any' | 'note' | 'call'): string | 2 {
  const [typed, ...rest] = args;
  if (typed === undefined || rest.length) return usage(command);
  const n = named(typed);
  if (!n.ok) { warn(n.why); return 2; }
  if (takes === 'note' && n.from === 'ahead') { warn('That’s the address of a call ahead, which has no note yet: a note’s ID ends the address of its call’s page, /calls/<id>.'); return 2; }
  if (takes === 'call' && n.from !== 'id') { warn('An address names a call’s note or its meeting, not one of its runs: operator call <address> gives the ID of each.'); return 2; }
  return n.id;
}

const yes = (b: boolean) => (b ? 'yes' : 'no');
const jobState = (j: JobNow) => `${j.state}, attempt ${j.attempt}, ${j.leaseUntil === null ? 'no lease' : `lease until ${j.leaseUntil}`}, ${j.claimable ? 'claimable now' : 'not claimable now'}`;
const jobLine = (j: NotesJobAnswer | null) => (j === null ? 'none' : `${j.jobId}: ${jobState(j)}; queued ${j.again ? 'at or after' : 'at'} ${j.queuedAt}`);
const byRole = (x: { host: number; invited: number; guest: number }) => `${x.host} host, ${x.invited} invited, ${x.guest} guests`;

function runLines(r: CallRunAnswer): string[] {
  const rows: [string, string][] = [
    ['Call', r.callId],
    ['State', r.state === 'live' ? `live since ${r.startedAt}, ${r.seconds} s` : `ended ${r.endedAt ?? ''}, after ${r.seconds} s`],
    ['Past its longest', r.pastLongestS ? `by ${r.pastLongestS} s` : 'no'],
    ['Locked', yes(r.locked)],
    ['Generation', String(r.generation)]
  ];
  if (r.host !== null) rows.push(['Host', r.host === 'away' ? `away for ${r.hostAwayS ?? 0} s` : r.host]);
  const p = r.inside;
  if (p) {
    rows.push(['In', byRole(p.people.in)], ['Waiting', byRole(p.people.waiting)], ['Left', byRole(p.people.left)], ['Turned away', byRole(p.people.denied)],
      ['Places', `${p.places.taken} of ${p.places.most}`], ['Stand-in hosts', yes(p.standIn)],
      ['Notes', `${p.notes.status}${p.notes.everOn ? ', on at some point' : ''}, segment ${p.notes.segment}`],
      ['Breakout rooms', `${p.breakoutRooms} open`], ['Shares', `${p.liveShares} live`], ['Timer', p.timerRunning ? 'running' : 'not running']);
  } else rows.push(['Inside', 'its sealed state didn’t open']);
  const rec = r.recorder;
  rows.push(['Recorder', rec === null ? 'none'
    : `${rec.recordingId}: ${rec.state}; ${rec.segments} segments, ${rec.pieces} pieces, ${rec.seconds} s; ${rec.clips} clips${rec.sinceLastClipS === null ? '' : `, the last ${rec.sinceLastClipS} s ago`}`]);
  rows.push(['Notes job', jobLine(r.notesJob)]);
  const room = r.room;
  rows.push(['Room', r.livekit === 'not-asked' ? 'not asked' : r.livekit === 'unanswered' || room === null ? 'LiveKit didn’t say'
    : room.exists ? `up, ${room.participants} in it, ${room.publishers} publishing` : 'gone']);
  const on = Object.entries(r.signals).flatMap(([name, lit]) => (lit ? [name] : []));
  rows.push(['Signals', on.length ? on.join(', ') : 'none']);
  return aligned(rows);
}

function callLines(a: CallAnswer): string[] {
  const runs = a.runs.length ? `${a.runs.length}${a.olderRuns ? ` of ${a.runs.length + a.olderRuns}` : ''}, newest first` : 'none: it hasn’t started';
  const lines = aligned([['Matched as', a.matchedAs], ['Meeting', a.meetingId], ['Runs', runs]]);
  for (const r of a.runs) lines.push('', ...runLines(r));
  return lines;
}

/** A line the instance logged about a note: when, what it says, and then the error's code and another service's status. */
const loggedLine = (l: NoteLine) => {
  const why = [...(l.code === null ? [] : [l.code]), ...(l.upstreamStatus === null ? [] : [`upstream ${l.upstreamStatus}`])];
  return `${l.at} ${l.msg}${why.length ? ` (${why.join(', ')})` : ''}`;
};

function noteLines(a: NoteAnswer): string[] {
  const rec = a.recording;
  const s = a.screens;
  const wrong: [string, string][] = a.recent.length ? a.recent.map((l): [string, string] => ['Went wrong', loggedLine(l)]) : [['Went wrong', 'nothing, on this instance']];
  return aligned([
    ['Note', a.noteId],
    ['Recording', rec === null ? 'none' : `${rec.recordingId}: ${rec.state}, started ${rec.startedAt}${rec.endedAt === null ? '' : `, ended ${rec.endedAt}`}`],
    ['Screens’ tail', rec?.screensTailEndsBy ? `ends by ${rec.screensTailEndsBy}` : 'none'],
    ['Notes job', jobLine(a.job)],
    ['Live transcript', `${a.transcript.clips} clips${a.transcript.sinceLastS === null ? '' : `, the last ${a.transcript.sinceLastS} s ago`}`],
    ...a.exports.map((x): [string, string] => ['Drive export', `${x.format} to the ${x.to === 'organizer' ? 'organizer’s' : 'Drive of someone invited'}: ${x.state}, attempt ${x.attempt}, due ${x.dueAt}${x.leased ? ', leased' : ''}`]),
    ['Shared screens', `${s.pieces} pieces (${s.bytes} bytes) to join, ${s.videos} videos joined, joining ${s.joinDue ? 'due' : 'not due'}`],
    ...wrong
  ]);
}

const call: CliCommand = {
  words: ['call'],
  usage: 'call <id or /calls/… address>                a call by its, its meeting’s or its note’s ID: each run, its room and signals',
  async run(ctx, args) {
    const id = oneId(args, call, 'any');
    if (id === 2) return id;
    return answered(ctx, await ctx.call('GET', `/v1/operator/calls/${id}`), (body) => callLines(CallAnswer.parse(body)));
  }
};

const callEndCommand: CliCommand = {
  words: ['call', 'end'],
  usage: 'call end <call id> --reason <ref>            ends a call that’s stuck; one that isn’t is left as it is',
  async run(ctx, args) {
    const id = oneId(args, callEndCommand, 'call');
    if (id === 2) return id;
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', `/v1/operator/calls/${id}/end`, reason), (body) => {
      const a = CallEndAnswer.parse(body);
      return [`Call ${a.callId} ended: everyone was disconnected, and its notes, if it had them, are being written.`];
    });
  }
};

const roomCloseCommand: CliCommand = {
  words: ['call', 'room', 'close'],
  usage: 'call room close <call id> --reason <ref>     closes the LiveKit room of a call that has ended',
  async run(ctx, args) {
    const id = oneId(args, roomCloseCommand, 'call');
    if (id === 2) return id;
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', `/v1/operator/calls/${id}/room/close`, reason), (body) => {
      const a = RoomCloseAnswer.parse(body);
      return [a.deleted ? `The room of call ${a.callId} was up, and is closed.` : `Call ${a.callId} had no room up; nothing was closed.`];
    });
  }
};

const note: CliCommand = {
  words: ['note'],
  usage: 'note <note id or /calls/<id> address>        where a note’s writing stands: its recording, notes job, exports, screens, what went wrong',
  async run(ctx, args) {
    const id = oneId(args, note, 'note');
    if (id === 2) return id;
    return answered(ctx, await ctx.call('GET', `/v1/operator/notes/${id}`), (body) => noteLines(NoteAnswer.parse(body)));
  }
};

const noteRetryCommand: CliCommand = {
  words: ['note', 'retry'],
  usage: 'note retry <note id> --reason <ref>          makes its notes job due now, if it waits on the model or to be tried again',
  async run(ctx, args) {
    const id = oneId(args, noteRetryCommand, 'note');
    if (id === 2) return id;
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', `/v1/operator/notes/${id}/retry`, reason), (body) => {
      const a = NoteRetryAnswer.parse(body);
      return [...aligned([['Notes job', a.jobId], ['Before', jobState(a.before)], ['After', jobState(a.after)]]), 'The writer was started for the note’s organizer.'];
    });
  }
};

const exportsRetryCommand: CliCommand = {
  words: ['note', 'exports', 'retry'],
  usage: 'note exports retry <note id> --reason <ref>  makes its Drive exports that wait to be tried again due now',
  async run(ctx, args) {
    const id = oneId(args, exportsRetryCommand, 'note');
    if (id === 2) return id;
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', `/v1/operator/notes/${id}/exports/retry`, reason), (body) => {
      const a = ExportsRetryAnswer.parse(body);
      return [a.retried ? `${a.retried} Drive exports made due now; their exporters were started.` : 'No Drive export was waiting to be tried again; nothing was done.'];
    });
  }
};

/** Calls and notes: looking them up, ending a stuck call, closing a room left up, and retrying a note's writing or exports. */
export const callsAndNotes: CliCommand[] = [call, callEndCommand, roomCloseCommand, note, noteRetryCommand, exportsRetryCommand];
