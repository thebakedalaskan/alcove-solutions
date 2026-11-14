/*
 * The invitation to join a team (design › 5.2): who asked, a line on what Alcove is, the team's people in their arches and
 * who's on it, one button to join, the link written out for where buttons don't work, and a quiet foot that says who sent
 * it, when it runs out, and how to stop these emails. It looks as look.ts draws every email; its text part says the same.
 * People's and teams' names are whatever someone typed, so wherever one is said (subject, HTML, text) it's defused: a mail
 * app never makes a link of "evil.com" or "you@bank" in one. The link and the inviter's address are said as they are.
 */
import { type Email, escapeHtml, oneLine } from './email';
import { arches, button, heading, line, page, pictures, quietLink, small, writtenLink } from './look';

/** Someone named in an invitation: their name as Alcove shows it, and their address. */
export interface InvitationPerson { name: string; email: string }

export interface InvitationEmailInput {
  /** Who invited them. */
  from: InvitationPerson;
  /**
   * The team: its name, how many are on it (whoever invited included), and up to 4 of them, by name, for the arches, as
   * the app's card shows them (whoever invited first). The words name the others on it, and whoever invited when they're
   * all there is.
   */
  team: { name: string; people: number; faces: readonly { name: string }[] };
  /** The invitation's own link, `<web app>/invite#<secret>`. */
  link: string;
  /** How many days until it runs out (30, or what `team.invitation_seconds` makes it). */
  expiresInDays: number;
  /** The address's link to stop Alcove's invitation emails, `<web app>/stop-email#<token>`: the foot offers it when it's here. */
  stopLink?: string | undefined;
}

const ABOUT = 'Alcove is for calls: each one gets its notes and a workspace of its own.';
const SIGNED = 'Alcove · alcove.solutions';
/** A team name longer than this is cut short in the button and said as "the team" under the faces; the heading has it whole. */
const LONG = 24;
/** The most of a team's name the subject says, its last character an ellipsis when it's longer; the body has it whole. */
const SUBJECT_TEAM = 40;

/**
 * A name as an email says it: a zero-width space after each `.`, `:` and `@` in it, so no mail app turns "evil.com",
 * "https:" or "sam@bank" in someone's name, or a team's, into a link. It reads the same.
 */
const defused = (name: string): string => name.replace(/[.:@]/g, (c) => `${c}\u200B`);
/** A team's name as the subject says it: at most SUBJECT_TEAM characters, cut with an ellipsis. */
function forSubject(name: string): string {
  const chars = Array.from(name);
  return chars.length <= SUBJECT_TEAM ? name : `${chars.slice(0, SUBJECT_TEAM - 1).join('').trimEnd()}…`;
}

/** What someone's called: their name, or their address when that's all there is. */
const called = (p: InvitationPerson): string => oneLine(p.name) || oneLine(p.email);
/** Their first name: Sam Kowalski is Sam. */
const first = (name: string): string => name.split(' ')[0] ?? name;
/** Names as a sentence says them: "Sam", "Sam and Priya", "Sam, Priya and Ken". */
const andList = (names: readonly string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`);
const others = (n: number): string => `${n} ${n === 1 ? 'other' : 'others'}`;
const isLong = (name: string): boolean => Array.from(name).length > LONG;
/** A long name cut short for a button: its whole words up to LONG characters (or as many characters), then an ellipsis. */
function cutShort(name: string): string {
  if (!isLong(name)) return name;
  const start = Array.from(name).slice(0, LONG).join('');
  const space = start.lastIndexOf(' ');
  return `${(space > LONG / 3 ? start.slice(0, space) : start).replace(/[\s,.:;·–—-]+$/u, '')}…`;
}

/**
 * Who's on the team, said of `place` (its name, defused, "the team" for a long one, or "it"): "Priya, Ken and 3 others are on
 * Vandelay." Up to two people besides whoever invited, then how many more; everyone by name while it's three people or
 * fewer and all of them are known; and "Sam is on Vandelay." while whoever invited is alone on it. Every name is defused.
 */
function whoIsOn(i: InvitationEmailInput, place: string): string {
  const inviter = called(i.from);
  const known = i.team.faces.map((f) => oneLine(f.name)).filter((n) => n && n.toLowerCase() !== inviter.toLowerCase()).map((n) => defused(first(n)));
  const me = defused(first(inviter));
  const everyone = Math.max(i.team.people, known.length + 1);
  if (everyone === 1) return `${me} is on ${place}.`;
  if (everyone <= 3 && known.length === everyone - 1) return `${andList([me, ...known])} are on ${place}.`;
  const named = known.slice(0, 2);
  if (!named.length) return `${me} and ${others(everyone - 1)} are on ${place}.`;
  return `${named.join(', ')} and ${others(everyone - named.length)} are on ${place}.`;
}

export function invitationEmail(i: InvitationEmailInput): Email {
  const e = escapeHtml;
  const link = oneLine(i.link);
  const stopLink = i.stopLink ? oneLine(i.stopLink) : '';
  const inviter = called(i.from);
  const from = defused(first(inviter));
  const rawTeam = oneLine(i.team.name);
  const team = defused(rawTeam);
  const days = Math.max(1, Math.round(i.expiresInDays));
  const join = `Join ${team}`;
  const on = whoIsOn(i, isLong(rawTeam) ? 'the team' : team);
  const faces = i.team.faces.map((f) => oneLine(f.name)).filter(Boolean);
  // The inviter's address is said as it is: it's who to reply to.
  const sent = `${defused(inviter)} (${oneLine(i.from.email)}) invited you. The invitation runs out in ${days} ${days === 1 ? 'day' : 'days'}. If you weren’t expecting it, you can ignore this email.`;
  const stop = 'Don’t want invitations from Alcove?';
  const subject = `${from} invited you to join ${defused(forSubject(rawTeam))} on Alcove`;

  const card = [
    heading(`${e(from)} invited you to join ${e(team)}`),
    line(e(ABOUT), 14),
    arches(faces, 28),
    line(e(on).replace(/(\d) (others?)\b/g, '$1&nbsp;$2'), faces.length ? 12 : 14),
    button(e(link), e(`Join ${defused(cutShort(rawTeam))}`), 28),
    small('Or open this link:', 26),
    writtenLink(e(link), 8)
  ].join('\n');
  const foot = [
    small(e(sent), 0),
    stopLink ? small(`${e(stop)} ${quietLink(e(stopLink), 'Stop them')}.`, 12) : '',
    small(e(SIGNED), 18)
  ].filter(Boolean).join('\n');

  const text = [
    `${from} invited you to join ${team}`,
    '',
    ABOUT,
    on,
    '',
    `${join}: ${link}`,
    '',
    sent,
    ...(stopLink ? ['', `${stop} Stop them: ${stopLink}`] : []),
    '',
    SIGNED
  ].join('\n');

  return {
    subject: oneLine(subject),
    html: page({ title: subject, preheader: `${whoIsOn(i, 'it')} Join them on Alcove.`, card, foot }),
    text,
    inline: pictures()
  };
}
