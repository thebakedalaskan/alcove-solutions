/*
 * Picking a time: what a link shows while the call offers times. It's public, with no account and no camera: nothing
 * here starts a device. Times are in the guest's own zone, which is named. The first to pick settles it; anyone after
 * that is told which time was taken, and gets the call's link.
 */
import { errorCode, errorMessage, firstName, type CallCard, type Meeting } from '@alcove/api';
import { Avatar, Button, DoneTick, GuestCard, Icon, LinkRow, Notice, TimeChoice, buttonClass, keptLines } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { copyUrl, joinUrl, shownUrl, useCopyLink } from '~/features/call/session/links';
import { listNames } from '~/lib/people';
import { usePickTime } from '~/features/calls/list/queries';
import { hm, hoursAndMinutes, shortDay, timeZone } from '~/lib/time';
import { saveCalendarFile } from './pickTimeCalendar';

/** Where this browser is, in words: "Toronto time", or "UTC". */
function zoneName(): string {
  const zone = timeZone();
  const city = zone.split('/').at(-1)?.replaceAll('_', ' ') ?? zone;
  return zone.includes('/') && !zone.startsWith('Etc/') ? `${city} time` : city;
}
const dayAndTime = (iso: string) => `${shortDay(new Date(iso))}, ${hm(iso)}`;

/** What the notes will be, for someone deciding on a time, and only what's true of this call. */
function notesLine(card: CallCard): string {
  if (card.notes === 'off') return `This call isn’t set to have notes. ${firstName(card.organizerName)} can turn them on during it.`;
  return ['This call has notes.', card.you === 'invited' ? 'You get them after.' : 'Everyone invited gets them after.', ...keptLines(card.choices)].join(' ');
}

export function PickTime({ card, code }: { card: CallCard; code: string }) {
  const pick = usePickTime(code);
  // What was offered when the page opened: the card stops saying once someone has picked.
  const [offer] = useState(card.offer);
  const [chosen, setChosen] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const organizer = firstName(card.organizerName);
  const calendar = (startsAt: string, minutes: number) => saveCalendarFile({ code, title: card.title, organizerName: card.organizerName, startsAt, minutes, url: joinUrl(code) });

  if (mine && offer) {
    return (
      <GuestCard>
        <DoneTick />
        <h1>You’re on {organizer}’s calendar</h1>
        <p>{dayAndTime(mine)} {zoneName()}. Come back to this link to join.</p>
        <Button size="lg" icon="cal" onClick={() => calendar(mine, offer.minutes)}>Add to my calendar</Button>
      </GuestCard>
    );
  }
  /* Picked before this opened, there's no telling how long the call is, so no calendar file; there's still the link. */
  if (!card.offer || !offer) {
    return (
      <GuestCard>
        <Avatar person={{ name: card.organizerName }} size={56} />
        <h1>Someone already picked a time</h1>
        <p>{card.title} is on {dayAndTime(card.startsAt)} {zoneName()}. Here’s its link.</p>
        <LinkRow link={shownUrl(code)} onCopy={() => copyUrl(code)} />
        {offer && <Button size="lg" icon="cal" onClick={() => calendar(card.startsAt, offer.minutes)}>Add to my calendar</Button>}
      </GuestCard>
    );
  }
  const times = offer.times.filter((t) => new Date(t).getTime() > Date.now());
  if (!times.length) {
    return (
      <GuestCard>
        <Avatar person={{ name: card.organizerName }} size={56} />
        <h1>These times have passed</h1>
        <p>Ask {organizer} for some new ones.</p>
      </GuestCard>
    );
  }
  const confirm = () => { if (chosen) pick.mutate(chosen, { onSuccess: () => setMine(chosen) }); };
  return (
    <GuestCard>
      <Avatar person={{ name: card.organizerName }} size={56} />
      <h1>Pick a time with {organizer}</h1>
      <p>{card.title} · {hoursAndMinutes(offer.minutes)}</p>
      <div className="rg-times">
        {times.map((t) => <TimeChoice key={t} time={hm(t)} day={`${shortDay(new Date(t))} · ${zoneName()}`} picked={t === chosen} onPick={() => setChosen(t)} />)}
      </div>
      <p className="rg-sealed"><Icon name="sealed" size={14} />{notesLine(card)}</p>
      {pick.isError && errorCode(pick.error) !== 'conflict' && <Notice tone="caution" icon="x">{errorMessage(pick.error)}</Notice>}
      <Button variant="primary" size="lg" disabled={!chosen} loading={pick.isPending} onClick={confirm}>{chosen ? `Confirm ${dayAndTime(chosen)}` : 'Pick a time'}</Button>
    </GuestCard>
  );
}

/** The organizer on their own link, while it offers times: nobody can join yet, and there's nothing to pick. */
export function PickTimeWaiting({ meeting }: { meeting: Meeting }) {
  const copy = useCopyLink();
  const who = meeting.guests.length ? listNames(meeting.guests) : 'your guest';
  return (
    <GuestCard>
      <Avatar person={meeting.organizer} size={56} />
      <h1>Waiting for {who} to pick</h1>
      <p>{meeting.title}. Nobody can join until a time is picked.</p>
      <div className="rg-times">
        {(meeting.offer?.times ?? []).map((t) => <TimeChoice key={t} time={hm(t)} day={`${shortDay(new Date(t))} · ${zoneName()}`} picked={false} />)}
      </div>
      <Button size="lg" icon="link" onClick={() => copy(meeting.code)}>Copy link</Button>
      <Link to="/home" className={buttonClass({ variant: 'quiet' })}>Go home</Link>
    </GuestCard>
  );
}
