/*
 * Who's in the call: people joining and leaving, a reload, who could host next, what's said (and heard by the notes),
 * asking to join and being let in, ringing, and what LiveKit says of someone's microphone and share.
 */
import { AlcoveApiError, RING_SECONDS, type CallParticipant, type Person, type RingReply } from '@alcove/api';
import { sessions } from '~/features/call/session/handoff';
import { talking } from '../../browser';
import type { Screen } from '../../media/screens';
import { personAt } from '../../world/people';
import { current, nextId } from '../state';
import { firstOf, identity, sameAs } from './base';
import { CallWithBoards } from './boards';
import type { Line, Present } from './script';

/** How long a line takes to say. */
const sayingMs = (text: string) => Math.min(5600, Math.max(2200, text.length * 55));

export abstract class CallWithPeople extends CallWithBoards {
  /** Everyone's seat, by address or name: the same across their reconnections. */
  private seats = new Map<string, string>();
  private connections = 0;
  /** Until when you're saying a line, so your microphone murmurs as a voice does, and until when each of them is. */
  private voiceUntil = 0;
  private speakingUntil = new Map<string, number>();
  /** The organizer's connection dropped: since when, for the stretch the notes mark. */
  protected away: { from: string; at: number; organizer: Person; seat: string } | null = null;

  protected join(p: Person, o: { organizer?: boolean | undefined; guest?: boolean | undefined; mic?: boolean | undefined; hand?: boolean | undefined; sharing?: Screen | undefined; status?: Present['status'] } = {}): void {
    if (this.find(p)) return;
    this.connections += 1;
    const key = p.email || p.name;
    const seat = this.seats.get(key) ?? `seat-${this.seats.size + 1}`;
    this.seats.set(key, seat);
    const id = identity(`${key}${this.ticket.callId}${this.connections}`);
    if (o.guest) this.guests.add(id);
    // As the server shows people: a guest by the name they typed, with no address, and to a guest, nobody's address.
    const shown = o.guest || this.me.person.email === '' ? { ...p, email: '' } : p;
    const joined: CallParticipant = { id, seat, person: shown, isMe: false, isOrganizer: o.organizer ?? false, hand: o.hand ?? false, status: null, othersPoint: true };
    this.change((s) => ({ ...s, participants: [...s.participants, joined], host: o.organizer && !this.away ? { ...s.host, id } : s.host }));
    if (o.hand) this.handFor(joined, true);
    if (o.status) this.statusFor(joined, o.status.kind, o.status.minutes);
    this.cue('join');
    this.crypto.update((c) => ({ ...c, members: c.place === 'main' && c.status === 'in' ? [...c.members, id] : c.members, everyone: [...c.everyone, id] }));
    this.livekit.update((r) => ({ ...r, people: { ...r.people, [id]: { mic: o.mic ?? true, speaking: false, screen: o.sharing ?? null, sound: false } } }));
  }
  /**
   * Someone leaves on purpose, or is removed: whatever they were presenting ends with them for good, and that's said at once
   * where it was presented. Nobody stopped it, so it ended for them, and everyone following keeps it open on their own.
   */
  protected goes(p: Person): void {
    const x = this.find(p);
    if (!x) return;
    for (const [place, q] of [...this.presented]) if (q.by.seat === x.seat) this.endIt(place, q, false);
    this.drops(x);
    this.cue('leave');
  }
  /**
   * Someone's connection is gone, as a reload or a dropped connection leaves it: they're gone from the people, and what they
   * present is hidden until they're back, with nothing said to have ended. What they played for everyone ends with them, and
   * they're not in the workspace any more.
   */
  protected drops(x: CallParticipant): void {
    this.change((s) => ({
      ...s, attention: { ...s.attention, hands: s.attention.hands.filter((h) => h.seat !== x.seat) }, participants: s.participants.filter((q) => q.id !== x.id), spotlight: s.spotlight === x.id ? null : s.spotlight,
      breakouts: s.breakouts.open ? { ...s.breakouts, open: { ...s.breakouts.open, rooms: s.breakouts.open.rooms.map((r) => ({ ...r, members: r.members.filter((m) => m !== x.id) })) } } : s.breakouts
    }));
    this.crypto.update((c) => ({ ...c, members: c.members.filter((m) => m !== x.id), everyone: c.everyone.filter((m) => m !== x.id) }));
    this.livekit.update((r) => { const { [x.id]: _gone, ...rest } = r.people; return { ...r, people: rest }; });
    this.space((w) => ({ ...w, play: w.play?.by.seat === x.seat ? null : w.play }));
    this.showBoard();
    if (this.where.delete(x.id)) this.sayWhere();
    this.hosting();
  }
  /**
   * Someone's page reloads: their connection drops (`drops`), so they're gone from the people and what they present is hidden,
   * with nothing said to have ended; `seconds` later they're back on a new connection, in the same seat and the same part of the
   * call, presenting it as it was, with the same key.
   */
  protected reloads(who: Person, seconds: number): void {
    const x = this.find(who);
    if (!x) return;
    const room = this.whereIs(x.id);
    const where = this.where.get(x.id);
    const mic = this.livekit.getSnapshot().people[x.id]?.mic;
    const guest = this.guests.has(x.id);
    this.drops(x);
    this.after(seconds * 1000, () => {
      this.join(who, { organizer: x.isOrganizer, guest, mic, hand: x.hand });
      const back = this.find(who);
      if (!back) return;
      if (room !== 'main' && this.getSnapshot().breakouts.open?.rooms.some((r) => r.id === room)) {
        this.change((s) => (s.breakouts.open ? { ...s, breakouts: { ...s.breakouts, open: { ...s.breakouts.open, rooms: s.breakouts.open.rooms.map((r) => (r.id === room ? { ...r, members: [...r.members, back.id] } : r)) } } } : s));
        this.crypto.update((c) => ({ ...c, members: c.place === room ? [...c.members.filter((m) => m !== back.id), back.id] : c.members.filter((m) => m !== back.id) }));
      }
      if (where) { this.where.set(back.id, where); this.sayWhere(); }
      this.showBoard();
      this.hosting();
    });
  }
  /** Who could host after whoever hosts now: people invited who are in the main room, by when they came. */
  protected hosting(): void {
    this.change((s) => {
      if (!s.isHost) return { ...s, host: { ...s.host, next: [] } };
      const inRoom = (id: string) => !!s.breakouts.open?.rooms.some((r) => r.members.includes(id));
      const next = s.participants.filter((p) => !p.isMe && !this.guests.has(p.id) && p.person.email !== '' && !inRoom(p.id)).map((p) => p.id);
      return { ...s, host: { ...s.host, next } };
    });
  }
  /** What's said: whoever says it speaks for a moment, and while notes are on where they are, it's transcribed. */
  protected say(l: Line): void {
    const mine = l.who === 'me';
    const who = l.who === 'me' ? this.getSnapshot().participants.find((p) => p.isMe) : this.find(l.who);
    if (!who) return;
    // Nobody hears a microphone that's off.
    if (mine ? !sessions.media?.getSnapshot().mic : !this.livekit.getSnapshot().people[who.id]?.mic) return;
    const ms = sayingMs(l.text);
    if (mine) {
      this.voiceUntil = Date.now() + ms;
      talking(true);
      this.after(ms, () => { if (Date.now() >= this.voiceUntil) talking(false); });
    } else {
      this.them(who.person, (t) => ({ ...t, speaking: true }));
      this.speakingUntil.set(who.id, Date.now() + ms);
      this.after(ms, () => { if (Date.now() >= (this.speakingUntil.get(who.id) ?? 0) - 30) this.them(who.person, (t) => ({ ...t, speaking: false })); });
    }
    this.heardLine(l, this.getSnapshot().elapsed);
  }

  /* ---------- asking to join, and being let in ---------- */

  protected letMeIn(): void {
    if (this.crypto.getSnapshot().status !== 'waiting') return;
    const signedIn = this.me.person.email !== '';
    // Someone signed in let in from the link is on the invite now, and gets the notes.
    if (signedIn) current().meetings = current().meetings.map((m) => (m.id === this.meeting.id ? { ...m, guests: [...m.guests, this.me.person], guestCount: m.guestCount + 1 } : m));
    this.change((s) => ({ ...s, participants: [...s.participants, this.me], role: signedIn ? 'invited' : 'guest' }));
    this.crypto.update((c) => ({ ...c, status: 'in', members: [...this.getSnapshot().participants.map((p) => p.id)], everyone: this.getSnapshot().participants.map((p) => p.id) }));
  }
  admit(id: string): Promise<void> {
    const asker = this.getSnapshot().waiting.find((w) => w.id === id);
    this.change((s) => ({ ...s, waiting: s.waiting.filter((w) => w.id !== id) }));
    if (!asker) return Promise.resolve();
    // Someone signed in let in from the link is on the invite now; someone by name is a guest.
    if (asker.person.email) current().meetings = current().meetings.map((m) => (m.id === this.meeting.id && !m.guests.some((g) => sameAs(g, asker.person)) ? { ...m, guests: [...m.guests, asker.person], guestCount: m.guestCount + 1 } : m));
    this.after(600, () => { this.join(asker.person, { guest: !asker.person.email }); this.hosting(); });
    return Promise.resolve();
  }
  deny(id: string): Promise<void> { this.change((s) => ({ ...s, waiting: s.waiting.filter((w) => w.id !== id) })); return Promise.resolve(); }
  /** Rings each of them: they answer as the script says, or come in a few seconds later. Anyone rung is on the invite. */
  ring(emails: string[]): Promise<void> {
    emails.forEach((email, i) => {
      const person = personAt(email);
      const id = nextId('rung');
      this.change((s) => ({ ...s, ringing: [...s.ringing.filter((r) => !sameAs(r.person, person)), { id, person, state: 'ringing', since: new Date().toISOString() }] }));
      current().meetings = current().meetings.map((m) => (m.id === this.meeting.id && !m.guests.some((g) => sameAs(g, person)) ? { ...m, guests: [...m.guests, person], guestCount: m.guestCount + 1 } : m));
      const answer = this.script.answers?.[email] ?? { after: 5 + i * 3, reply: 'join' };
      this.after(answer.after * 1000, () => this.answered(id, answer.reply));
      this.after(RING_SECONDS * 1000, () => this.answered(id, 'missed'));
    });
    return Promise.resolve();
  }
  private answered(id: string, reply: RingReply | 'missed'): void {
    const r = this.getSnapshot().ringing.find((x) => x.id === id && x.state === 'ringing');
    if (!r) return;
    const at = new Date().toISOString();
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    const next = reply === 'join' ? { ...r, state: 'coming' as const }
      : reply === 'in-5' ? { ...r, state: 'later' as const, until: later(5) }
        : reply === 'in-15' ? { ...r, state: 'later' as const, until: later(15) }
          : reply === 'no' ? { ...r, state: 'declined' as const, since: at } : { ...r, state: 'missed' as const, since: at };
    this.change((s) => ({ ...s, ringing: s.ringing.map((x) => (x.id === id ? next : x)) }));
    if (reply === 'join') this.after(2500, () => { this.change((s) => ({ ...s, ringing: s.ringing.filter((x) => x.id !== id) })); this.join(r.person); this.hosting(); });
  }
  stopRing(ringId: string): Promise<void> { this.change((s) => ({ ...s, ringing: s.ringing.filter((r) => r.id !== ringId) })); return Promise.resolve(); }
  mute(identity: string, _trackSid: string): Promise<void> {
    const now = this.livekit.getSnapshot().people[identity];
    if (now) this.livekit.update((r) => ({ ...r, people: { ...r.people, [identity]: { ...now, mic: false, speaking: false } } }));
    return Promise.resolve();
  }
  /**
   * The organizer stops what someone shares, for everyone: LiveKit mutes it. Everyone else is told who stopped it, and you, who
   * did, have your own words for it.
   */
  stopShare(seat: string): Promise<void> {
    if (!this.getSnapshot().isOrganizer) return Promise.reject(new AlcoveApiError('forbidden', 'Only the organizer can do that.'));
    const p = this.getSnapshot().participants.find((x) => x.seat === seat);
    const nothing = new AlcoveApiError('conflict', 'They aren’t sharing anything.');
    if (p?.isMe) {
      if (!sessions.media?.getSnapshot().screen) return Promise.reject(nothing);
      this.livekit.update((r) => ({ ...r, sharesStopped: r.sharesStopped + 1 }));
      return Promise.resolve();
    }
    const them = p ? this.livekit.getSnapshot().people[p.id] : undefined;
    if (!p || !them?.screen) return Promise.reject(nothing);
    this.livekit.update((r) => ({ ...r, people: { ...r.people, [p.id]: { ...them, screen: null, sound: false } } }));
    return Promise.resolve();
  }
  /** The organizer, when it isn't you, stops what someone shares, yours or anyone's: it stops for everyone, and you're told who stopped it. */
  protected theyStopShare(who: Person | 'me'): void {
    const s = this.getSnapshot();
    const organizer = firstOf(s.participants.find((p) => p.isOrganizer)?.person ?? this.meeting.organizer);
    const whose = who === 'me' ? this.me : this.find(who);
    if (!whose) return;
    if (who === 'me') this.livekit.update((r) => ({ ...r, sharesStopped: r.sharesStopped + 1 }));
    else this.them(who, (t) => ({ ...t, screen: null, sound: false }));
    if (!s.isOrganizer) this.change((x) => ({ ...x, notices: [...x.notices, { id: nextId('notice'), text: `${organizer} stopped ${firstOf(whose.person)}’s share.`, kind: 'people' }] }));
  }
  remove(id: string): Promise<void> {
    const p = this.getSnapshot().participants.find((x) => x.id === id);
    if (p) this.goes(p.person);
    return Promise.resolve();
  }
}
