/*
 * What invitations say (docs/design/pages.md › Team; the design's 4.1–4.6), in one place: who's on a team as its card says
 * it, an invitation's heading, what's said once people are invited or an invitation is sent again, and an invitation's line
 * on the team's list. Never that an email went: one may wait for the next day, or its address may have stopped them.
 */
import type { InvitationForYou, InvitePeek, Person, TeamGlimpse, TeamInvitation } from '@alcove/api';
import { callName, sameEmail } from '~/lib/people';
import { dayMonth, daysFromToday } from '~/lib/time';
import { joined, plural } from '~/lib/words';

/** What a card says of Alcove to someone who isn't on it yet. */
export const WHAT_ALCOVE_IS = 'Alcove is for calls: each one gets its notes and a workspace of its own.';

/** Whether a face on a team is `p`: faces are named, never addressed, so by address only where both have one. */
const isFace = (face: Person, p: Person): boolean => (face.email !== '' && p.email !== '' ? sameEmail(face, p) : face.name === p.name);

/**
 * Who's on a team, as its card says it, from the faces it's shown with: "Kofi, Aiko and 2 others are on it.", "Priya and
 * Kofi are on it.", "Priya is on it." Whoever asked is named last, the heading having named them already.
 */
export function whoIsOn(team: TeamGlimpse, from: Person | null): string {
  const asker = from === null ? undefined : team.faces.find((p) => isFace(p, from));
  const faces = [...team.faces.filter((p) => p !== asker), ...(asker ? [asker] : [])];
  const n = team.people;
  const [first] = faces;
  if (n <= 0 || !first) return '';
  if (n === 1) return `${callName(first)} is on it.`;
  if (n <= 3 && faces.length >= n) return `${joined(faces.slice(0, n).map(callName))} are on it.`;
  const named = faces.slice(0, 2);
  return `${named.map(callName).join(', ')} and ${plural(n - named.length, 'other')} are on it.`;
}

/** An invitation to you, as its card's heading says it: "Priya invited you to join Vandelay Industries". */
export const invitedYou = (i: Pick<InvitationForYou, 'from' | 'team'>): string => `${callName(i.from)} invited you to join ${i.team.name}`;

/**
 * What a secret after /invite# is, as its card's heading says it: an invitation's own link, a team's link (anyone on it may
 * have shared it, so it names the team), the link of someone on no team yet, your own or your team's, or an invitation to
 * the team you're on already.
 */
export function peekTitle(peek: InvitePeek): string {
  if (peek.yours && peek.kind === 'invitation') return `You’re on ${peek.team?.name ?? 'that team'} already`;
  if (peek.yours) return peek.team ? 'This is your team’s invite link' : 'This is your invite link';
  if (peek.kind === 'invitation' && peek.team) return invitedYou({ from: peek.from, team: peek.team });
  if (peek.team) return `Join ${peek.team.name} on Alcove`;
  return `${callName(peek.from)} asked you to join them on Alcove`;
}
/** What Join says on a card: the team's name, or whoever's link it is while they're on no team. */
export const joinLabel = (peek: InvitePeek): string => `Join ${peek.team ? peek.team.name : callName(peek.from)}`;

/** People in a sentence, two by name and the rest counted: "Priya", "Priya and Ken", "Priya, Ken and 1 other". */
function someOf(people: readonly Person[]): string {
  const names = people.map(callName);
  return names.length <= 2 ? joined(names) : `${names.slice(0, 2).join(', ')} and ${plural(names.length - 2, 'other')}`;
}
/**
 * Said once people are invited: "Invited Priya, Ken and 1 other to Vandelay Industries.", or when inviting them started the
 * team, "Started Vandelay Industries and invited Diego." When some were on it already (the page had them as not yet), it says
 * how many; when only the first of them fitted in today's invitations (`over` didn't), how many and when the rest can be:
 * "Invited 20 people to Vandelay Industries. You can invite the other 5 tomorrow." Without the team's name (an answer from
 * Alcove's receipt of the request, read again without luck), it's "your team".
 */
export function invitedSaid(people: readonly Person[], name: string, made: { invited: number; already: number; over: number }, started = false): string {
  const team = name || 'your team';
  const { already, over } = made;
  const [one] = people;
  if (already > 0 && already >= people.length) return one && people.length === 1 ? `${callName(one)} is on ${team} already.` : `They’re on ${team} already.`;
  const who = over > 0 ? plural(made.invited, 'person', 'people') : someOf(people);
  const said = started ? `Started ${team} and invited ${who}.` : `Invited ${who} to ${team}.`;
  const more = already > 0 ? ` ${already === 1 ? 'One of them was' : `${already} of them were`} on it already.` : '';
  const later = over > 0 ? ` You can invite the other ${over === 1 ? 'one' : over} tomorrow.` : '';
  return `${said}${more}${later}`;
}
/** Said once an invitation is sent again: "Sent Lena's invitation again." */
export const sentAgain = (p: Person): string => `Sent ${callName(p)}’s invitation again.`;

/** "today", "yesterday", "3 days ago", "12 Oct": how long ago something happened, by the calendar. */
function daysAgo(iso: string, now: number): string {
  const days = -daysFromToday(new Date(iso), new Date(now));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 30 ? `${days} days ago` : dayMonth(new Date(iso));
}
/** "Runs out today", "Runs out tomorrow", "Runs out in 4 days": said in an invitation's last week, and nothing before. */
export function runsOut(expiresAt: string, now: number): string | null {
  const days = daysFromToday(new Date(expiresAt), new Date(now));
  if (days > 7) return null;
  return days <= 0 ? 'Runs out today' : days === 1 ? 'Runs out tomorrow' : `Runs out in ${days} days`;
}
/**
 * An invitation's line on the team's list, from when they were first invited, then when it was last sent again if it was,
 * then in its last week when it runs out: "Invited by Priya · 26 days ago · Runs out in 4 days", "Invited 2 days ago · Sent
 * again today".
 */
export function invitationLine(i: TeamInvitation, now: number): string {
  const first = daysAgo(i.madeAt, now);
  const by = i.you ? `Invited ${first}` : `Invited by ${callName(i.invitedBy)} · ${first}`;
  const again = Date.parse(i.at) - Date.parse(i.madeAt) > 60_000 ? `Sent again ${daysAgo(i.at, now)}` : null;
  return [by, again, runsOut(i.expiresAt, now)].filter((part) => part !== null).join(' · ');
}
/**
 * What Resend says while it can't be pressed, as Alcove says why (`resendWhy`): sent too recently, "Sent today" (or "Sent
 * yesterday", late yesterday), as it goes once a day at most; or sent as many times as this team may in its 30 days, "Sent 3
 * times". Null while it can be pressed.
 */
export function resendWaits(i: TeamInvitation, now: number): string | null {
  if (i.resendWhy === null) return null;
  if (i.resendWhy === 'most') return `Sent ${plural(i.sends, 'time')}`;
  return daysFromToday(new Date(i.at), new Date(now)) === 0 ? 'Sent today' : 'Sent yesterday';
}
/** Said as an invitation is put aside, with Undo: "Put aside. You can join it from Team until 4 Dec." (`expiresAt` when it's known). */
export const asideSaid = (expiresAt: string | null): string => `Put aside. You can join it from Team${expiresAt === null ? '' : ` until ${dayMonth(new Date(expiresAt))}`}.`;
/** An invitation of yours put aside, as its row says it: "Put aside · Runs out on 14 Dec". */
export const putAsideLine = (i: InvitationForYou, now: number): string => `Put aside · ${runsOut(i.expiresAt, now) ?? `Runs out on ${dayMonth(new Date(i.expiresAt))}`}`;
