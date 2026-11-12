/*
 * The call on its stage, always night: whoever was in it, in their arches, the one speaking at the moment the recording is
 * at lit, and what they said there as a caption. When a screen was shared then and kept for the notes, it plays here in their
 * place, with whose it is, and whoever's speaking small in the corner. A room recording has a microphone in its arch, lit
 * while anyone speaks. Nothing here plays: the player (Player.tsx) is the clock, and the stage draws what it says. Captions
 * go while the transcript is open beside it, which says the same.
 */
import type { Note, Person, Speaker, TranscriptLine } from '@alcove/api';
import { Avatar, Chip, GhostArch, Icon, Spinner, cn } from '@alcove/ui';
import { useEffect, useState } from 'react';
import { sameEmail, spokenName } from '~/lib/people';
import { usePlayerAt, useShareOnStage, type PlayerState } from './Player';

/** Someone on the stage: in an arch, by the name the stage gives them. `key` is how what they said finds them. */
interface OnStage { key: string; person: Pick<Person, 'name'> & Partial<Pick<Person, 'email' | 'photoUrl' | 'portrait'>>; name: string }

/** How a line's speaker is known on the stage: by their address, or by the name a guest gave. */
export const speakerKey = (s: Speaker): string => s.person?.email.toLowerCase() ?? `name:${s.name}`;

/** At most this many arches; past it, how many more. */
export const MOST_ARCHES = 6;
/** How big each arch is on the stage, by how many are on it. */
export const archSize = (n: number) => (n <= 3 ? 96 : n <= 5 ? 76 : 64);

/** Who was in the call: the organizer and everyone invited, then anyone else the transcript heard, and you last. */
export function peopleOn(note: Note, me: string | undefined): OnStage[] {
  const seen = new Set<string>();
  const others: OnStage[] = [];
  const mine: OnStage[] = [];
  const add = (key: string, person: OnStage['person'], name: string, isMe: boolean) => {
    if (seen.has(key)) return;
    seen.add(key);
    (isMe ? mine : others).push({ key, person, name: isMe ? 'You' : name });
  };
  for (const r of note.recipients) if (r.role !== 'shared') add(r.person.email.toLowerCase(), r.person, spokenName({ name: r.person.name, person: r.person }, me), !!me && sameEmail(r.person, { email: me }));
  for (const l of note.transcript ?? []) if (l.speaker) add(speakerKey(l.speaker), l.speaker.person ?? { name: l.speaker.name }, spokenName(l.speaker, me), !!me && !!l.speaker.person && sameEmail(l.speaker.person, { email: me }));
  return [...others, ...mine];
}

/** How long after a line is said it stays as the caption, in seconds, before a silence clears it. */
const CAPTION_HOLDS = 30;
/** How long before the first line the stage already shows it, so a call opened at its start shows who opened it. */
const FIRST_LEADS = 8;
/** The line being said at `at`, if one was a moment ago, or the first, about to be. */
export function lineAt(lines: readonly TranscriptLine[], at: number): TranscriptLine | undefined {
  const line = lines.findLast((l) => l.at <= at + 0.5);
  if (!line) return lines.find((l) => l.at - at <= FIRST_LEADS);
  return at - line.at <= CAPTION_HOLDS ? line : undefined;
}

/** How long a picture can take before the stage says it's on its way, so a quick seek doesn't flash. */
const SLOW_MS = 300;

/**
 * The stage. `here` is where the call is for a note with no recording to play: moving along the line moves it, and the stage
 * shows who spoke then. `captions` is whether the words show, and `live` that the call is still being recorded.
 */
export function Stage({ note, me, player, here, captions }: { note: Note; me: string | undefined; player: PlayerState; here: number; captions: boolean }) {
  const playing = player.total > 0;
  const heard = usePlayerAt(player, (p) => Math.floor(p * 4) / 4);
  const at = playing ? heard : here;
  const share = useShareOnStage(note.id, note.shares, player);
  const lines = note.transcript ?? [];
  const line = lineAt(lines, at);
  const room = note.rooms.find((r) => r.from <= at && at < r.to);
  const people = peopleOn(note, me);
  const lit = line?.speaker ? speakerKey(line.speaker) : null;
  const speaker = line?.speaker ? people.find((p) => p.key === lit) : undefined;
  const size = archSize(people.length);
  const shown = people.slice(0, people.length > MOST_ARCHES ? MOST_ARCHES - 1 : MOST_ARCHES);
  const more = people.length - shown.length;
  const on = share.share;
  // The picture on its way says so once it's taken long enough to notice.
  const loading = !!on && share.state === 'loading';
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!loading) return undefined;
    const t = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(t);
  }, [loading]);
  const whose = on?.label ?? 'the shared screen';
  return (
    <div className={cn('cd-stage', on && 'is-share', note.kind === 'room' && 'is-room')} role="group" aria-label={on ? `The call at this moment: ${on.label}` : 'The call at this moment'}>
      {share.video}
      {on && (
        <>
          <span className="cd-shot-l"><Icon name="monitor" size={14} /><span className="ac-clamp-1">{on.label}</span></span>
          {share.shares.length > 1 && (
            <span className="cd-picks" role="group" aria-label="Shared at this moment">
              {share.shares.map((s) => (
                <button key={s.id} type="button" className="cd-pick" aria-pressed={s.id === on.id} onClick={() => share.pick(s.id)}><Chip icon="monitor"><span className="ac-clamp-1">{s.label}</span></Chip></button>
              ))}
            </span>
          )}
          {speaker && <span className="cd-mini" title={speaker.name}><Avatar person={speaker.person} size={40} /></span>}
          {loading && slow && <span className="cd-says"><Spinner />Loading {whose}</span>}
          {share.state === 'failed' && <span className="cd-says" role="status">This part of {whose} couldn’t be played.<button type="button" className="cd-says-act" onClick={share.retry}>Try again</button></span>}
        </>
      )}
      {!on && (note.kind === 'room' ? (
        <div className="cd-arches">
          <span className={cn('cd-arch', line && 'is-speaking')}><span className="ring"><span className="cd-roomarch"><Icon name="mic" size={30} /></span></span><b>In the room</b></span>
        </div>
      ) : (
        <div className="cd-arches" style={{ '--arch': `${size}px` }}>
          {shown.map((p) => (
            <span key={p.key} className={cn('cd-arch', p.key === lit && 'is-speaking')}>
              <span className="ring"><Avatar person={p.person} size={size} /></span>
              <b className="ac-clamp-1">{p.name}</b>
            </span>
          ))}
          {more > 0 && <span className="cd-arch is-more"><span className="ring"><GhostArch size={size} more={more} /></span><b>{more} more</b></span>}
        </div>
      ))}
      {captions && (room && !line ? (
        <p className="cd-cap is-room"><Icon name="rooms" size={14} />In breakout rooms: {note.rooms.filter((r) => r.from <= at && at < r.to).map((r) => r.name).join(', ')}</p>
      ) : line ? (
        <p className="cd-cap" aria-live="off">{line.speaker && <b>{spokenName(line.speaker, me)}</b>}<span>{line.text}</span></p>
      ) : null)}
    </div>
  );
}
