/*
 * The right side of the welcome screens: the product working. Before sign-in, three people talk
 * and the phrases that matter fly down into a note. After sign-in, your profile, today's calls and
 * your team arrive in turn, and your face joins the note.
 */
import type { Meeting, Person, SignInProvider, Team } from '@alcove/api';
import { Avatar, Faces, Icon, ProviderMark, cn } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CAST, CARD_DONE, NoteCard, type NoteCardProgress } from '~/features/notes/NoteCard';
import { hm } from '~/lib/time';

const BUBBLES = [
  { k: 'theo', right: false, before: 'Sign-ups are back up since Tuesday’s fix.', mark: '', after: '' },
  { k: 'priya', right: true, before: 'Great. Then let’s ', mark: 'move the launch to the 18th', after: '.' },
  { k: 'kofi', right: false, before: 'Works for me. ', mark: 'I’ll send the new screens by Wednesday', after: '.' }
] as const;
const START: NoteCardProgress = { decided: false, followUp: false, summary: 'none', ready: false };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** What came with someone when they signed in. A demo account also brings its sample calendar. */
export interface Arrival { person: Person; provider: SignInProvider; sample: boolean; today: Meeting[]; team: Team | null }

export function Stage({ step, arrival }: { step: 'welcome' | 'ready'; arrival?: Arrival | undefined }) {
  const reduce = useReducedMotion() ?? false;
  const stage = useRef<HTMLDivElement>(null);
  const convo = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const marks = useRef<(HTMLElement | null)[]>([]);
  const [shown, setShown] = useState(0);
  const [lit, setLit] = useState(0);
  const [card, setCard] = useState<NoteCardProgress>(START);
  const [arrived, setArrived] = useState(0);
  const [you, setYou] = useState(false);

  /* Keep the note clear of what's around it on any screen, smaller if the stage is short. */
  useLayoutEffect(() => {
    const st = stage.current;
    const n = note.current;
    if (!st || !n) return;
    const place = () => {
      const H = st.clientHeight;
      if (step === 'welcome') {
        const c = convo.current;
        if (!c) return;
        const nh = n.offsetHeight + 24;
        const below = c.offsetTop + c.offsetHeight + 24;
        const s = Math.max(0.72, Math.min(innerWidth <= 560 ? 0.88 : 1, (H - 20 - below) / nh));
        const cy = Math.min(Math.max(H * 0.66, below + (nh * s) / 2), H - 16 - (nh * s) / 2);
        st.style.setProperty('--ny-welcome', `${Math.round(cy)}px`);
        st.style.setProperty('--ns-welcome', s.toFixed(3));
      } else {
        const k = stack.current;
        if (!k) return;
        const top0 = innerWidth <= 560 ? 84 : 92;
        const s = Math.max(0.74, Math.min(0.94, (H - top0 - 36 - k.offsetHeight - 26) / n.offsetHeight));
        const top = Math.max(top0, Math.round((H - (k.offsetHeight + 26 + n.offsetHeight * s)) / 2));
        k.style.top = `${top}px`;
        st.style.setProperty('--ny-ready', `${Math.round(top + k.offsetHeight + 26 + (n.offsetHeight * s) / 2)}px`);
        st.style.setProperty('--ns-ready', s.toFixed(3));
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(st);
    return () => ro.disconnect();
  }, [step, arrival?.today.length, arrival?.team, arrival?.sample]);

  /* Before sign-in: the conversation plays and the note writes itself, on a loop. */
  useEffect(() => {
    if (step !== 'welcome') return;
    setYou(false);
    if (reduce) { setShown(3); setLit(2); setCard(CARD_DONE); return; }
    let alive = true;
    const chips = new Set<HTMLElement>();
    const fly = async (i: number, sel: string, land: () => void) => {
      const from = marks.current[i];
      const to = note.current?.querySelector(sel);
      if (!from || !(to instanceof HTMLElement)) { land(); return; }
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const chip = document.createElement('div');
      chip.className = 'fly';
      chip.textContent = from.textContent;
      chip.style.left = `${a.left - 8}px`;
      chip.style.top = `${a.top - 5}px`;
      document.body.append(chip);
      chips.add(chip);
      const dx = b.left - (a.left - 8);
      const dy = b.top + (b.height - chip.offsetHeight) / 2 - (a.top - 5);
      const anim = chip.animate([
        { transform: 'translate(0, 4px) scale(0.96)', opacity: 0 },
        { transform: 'translate(0, -8px) scale(1.03)', opacity: 1, offset: 0.2 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.94)`, opacity: 1, offset: 0.86 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.94)`, opacity: 0 }
      ], { duration: 1150, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' });
      const t = setTimeout(() => { if (alive) land(); }, 930);
      await Promise.race([anim.finished.catch(() => undefined), sleep(1300)]);
      clearTimeout(t);
      chip.remove();
      chips.delete(chip);
    };
    void (async () => {
      for (;;) {
        setShown(0); setLit(0); setCard(START);
        await sleep(500); if (!alive) return;
        setShown(1);
        await sleep(1300); if (!alive) return;
        setShown(2);
        await sleep(950); if (!alive) return;
        setLit(1);
        await sleep(700); if (!alive) return;
        await fly(1, '.nc-d1', () => setCard((c) => ({ ...c, decided: true }))); if (!alive) return;
        await sleep(600); if (!alive) return;
        setShown(3);
        await sleep(950); if (!alive) return;
        setLit(2);
        await sleep(700); if (!alive) return;
        await fly(2, '.nc-f1', () => setCard((c) => ({ ...c, followUp: true }))); if (!alive) return;
        await sleep(450); if (!alive) return;
        setCard((c) => ({ ...c, summary: 'writing' }));
        await sleep(1500); if (!alive) return;
        setCard((c) => ({ ...c, ready: true }));
        await sleep(5200); if (!alive) return;
        setShown(0);
        await sleep(700); if (!alive) return;
      }
    })();
    return () => { alive = false; chips.forEach((c) => c.remove()); };
  }, [step, reduce]);

  /* After sign-in: what came with you arrives in turn (you, the calendar and its calls, your team), then your face joins the note. */
  const today = arrival?.today.slice(0, 3) ?? [];
  const order = arrival ? ['me', ...(arrival.sample ? ['cal', ...today.map((m) => `row:${m.id}`)] : []), ...(arrival.team ? ['team'] : [])] : [];
  const sequence = order.join('|');
  useEffect(() => {
    if (step !== 'ready' || !sequence) return;
    const keys = sequence.split('|');
    setShown(0); setCard(CARD_DONE);
    if (reduce) { setArrived(keys.length); setYou(true); return; }
    let alive = true;
    void (async () => {
      setArrived(0);
      await frame();
      await sleep(420); if (!alive) return;
      for (let i = 1; i <= keys.length; i++) {
        setArrived(i);
        // Calendar rows follow each other quickly; the cards take a breath.
        await sleep(keys[i - 1]?.startsWith('row:') ? 150 : 320); if (!alive) return;
      }
      await sleep(260); if (!alive) return;
      setYou(true);
    })();
    return () => { alive = false; };
  }, [step, sequence, reduce]);

  const on = (key: string) => { const i = order.indexOf(key); return i >= 0 && arrived > i ? 'on' : ''; };
  return (
    <div className="in-stage" data-step={step} ref={stage}>
      <div className="st-top" aria-hidden="true">
        <span className="st-pill"><i />Notes on</span>
        <span className="st-call"><Faces people={[CAST.theo, CAST.priya, CAST.kofi]} size={26} /><span>Weekly product call</span></span>
      </div>
      <div className="st-convo" ref={convo} aria-hidden="true">
        {BUBBLES.map((b, i) => (
          <div key={b.k} className={cn('bub', `t-${b.k}`, b.right && 'r', shown > i && 'on')}>
            <Avatar person={CAST[b.k]} size={36} />
            <div className="b">
              <span className="n">{CAST[b.k].name.split(' ')[0]}</span>
              {b.before}
              {b.mark && <mark ref={(el) => { marks.current[i] = el; }} className={cn('hl', lit >= i && 'on')}>{b.mark}</mark>}
              {b.after}
            </div>
          </div>
        ))}
      </div>
      {arrival && (
        <div className="st-arrive" aria-hidden="true">
          <div className={cn('st-me', on('me'))} data-in="">
            <Avatar person={arrival.person} size={30} />
            <span><b>{arrival.person.name}</b><small>{arrival.person.email}</small></span>
            <span className="prov">{arrival.provider === 'sso' ? <Icon name="key" size={16} /> : <ProviderMark provider={arrival.provider} />}</span>
          </div>
          <div className="st-stack" ref={stack}>
            {arrival.sample && (
              <div className={cn('st-cal', on('cal'))} data-in="">
                <div className="sc-h"><Icon name="cal" size={15} /><span>{today.length ? 'Today, from your calendar' : 'Your calendar'}</span></div>
                {today.length ? today.map((m) => (
                  <div key={m.id} className={cn('sc-row', on(`row:${m.id}`))} data-in="row">
                    <span className="tm mono">{hm(m.startsAt)}</span><b>{m.title}</b><Faces people={m.guests} size={22} max={3} />
                  </div>
                )) : <div className="sc-row on" data-in="row"><span className="tm mono">–</span><b>Nothing else today</b><span /></div>}
              </div>
            )}
            {arrival.team && (
              <div className={cn('st-team', on('team'))} data-in="">
                <Faces people={arrival.team.members.map((m) => m.person)} size={26} />
                <span><b>{arrival.team.name}</b> · {arrival.team.members.length} colleagues</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="st-note" id="stNote" ref={note} role="img" aria-label="Example: notes from a call, written as people talk">
        <NoteCard progress={card} you={step === 'ready' && you ? arrival?.person : null} />
      </div>
    </div>
  );
}
