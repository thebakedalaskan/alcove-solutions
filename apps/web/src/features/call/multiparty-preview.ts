/*
 * Multi-party preview. Calls have one participant today (calls with others arrive with LiveKit), so
 * this module stands in for the other people: five of Alcove's illustrated cast join, take turns
 * talking with captions, raise a hand, and go to breakout rooms. It's the only place they come from.
 *
 * Nothing here is sent to or stored by the server, and nothing here reaches the transcript or the
 * notes: those come from the real call only. Every place that reads it is marked with
 *   TODO(multi-party): replace with LiveKit participants
 * so swapping it for real participants is one search. See docs/engineering/calls-and-recordings.md
 * › Multi-party preview.
 */
import type { CaptionLanguage, LiveStore, Person } from '@alcove/api';
import { CAST, type CastId } from '~/features/notes/cast';
import { log } from '~/lib/log';

const plog = log.child({ component: 'multiparty-preview' });

const SWITCH = 'alcove.multipartyPreview';
/**
 * On in development, or in a build made with VITE_ALCOVE_MULTIPARTY_PREVIEW=on. `?preview=off` (or
 * `on`) in the address bar overrides that for the rest of the browser tab, to see a call exactly as
 * it is today.
 */
export function previewEnabled(): boolean {
  let choice: string | null = new URLSearchParams(location.search).get('preview');
  try {
    if (choice === 'on' || choice === 'off') sessionStorage.setItem(SWITCH, choice);
    else choice = sessionStorage.getItem(SWITCH);
  } catch (e) { plog.debug('preview switch not remembered; the build default applies', { err: e }); }
  if (choice === 'on' || choice === 'off') return choice === 'on';
  return import.meta.env.DEV || import.meta.env['VITE_ALCOVE_MULTIPARTY_PREVIEW'] === 'on';
}
if (typeof location !== 'undefined') previewEnabled();

const PEOPLE: CastId[] = ['theo', 'priya', 'kofi', 'lena', 'diego'];
/** Preview participants are told apart from real ones by this prefix on their ID. */
export const PREVIEW_PREFIX = 'preview:';
export const isPreviewId = (id: string) => id.startsWith(PREVIEW_PREFIX);
const personOf = (id: CastId): Person => ({ id: `${PREVIEW_PREFIX}${id}`, name: CAST[id].name, email: `${id}@preview.alcove.invalid`, portrait: CAST[id].portrait });

export interface PreviewParticipant { id: string; person: Person; mic: boolean; hand: boolean }
export interface PreviewCaption { id: string; who: string; lang: CaptionLanguage; text: Partial<Record<CaptionLanguage, string>> }
export interface PreviewRooms {
  /** Who is in each room, by participant ID, in the order of the rooms. */
  assign: string[][];
  /** Who is talking in each room. */
  talking: (string | null)[];
  /** Notes written in each room so far. */
  notes: number[];
  /** Someone in a room asked for help. */
  help: { room: number; id: string } | null;
  /** The room you're in, or null for the main room. */
  joined: number | null;
}
export interface PreviewSnapshot {
  people: PreviewParticipant[];
  speaking: string | null;
  caption: PreviewCaption | null;
  /** A preview participant spotlighted for everyone (the server only knows real participants). */
  spotlight: string | null;
  rooms: PreviewRooms | null;
}

type Line = { who: CastId; lang: CaptionLanguage; t: Partial<Record<CaptionLanguage, string>> };
const SCRIPT: Line[] = [
  { who: 'theo', lang: 'en', t: { en: 'Let’s start with the onboarding launch. Kofi, where are the new screens?', es: 'Empecemos con el lanzamiento del onboarding. Kofi, ¿cómo van las pantallas nuevas?', de: 'Fangen wir mit dem Onboarding-Start an. Kofi, wie weit sind die neuen Screens?', ja: 'まずオンボーディングのリリースから始めましょう。コフィ、新しい画面はどうですか？' } },
  { who: 'kofi', lang: 'en', t: { en: 'All three screens are done. The sign-in step is the one to look at.', es: 'Las tres pantallas están listas. Fíjense en el paso de inicio de sesión.', de: 'Alle drei Screens sind fertig. Schaut euch vor allem die Anmeldung an.', ja: '3つの画面はすべて完成しました。見てほしいのはサインインのステップです。' } },
  { who: 'priya', lang: 'en', t: { en: 'The sign-in step tested well. People finished it in under a minute.', es: 'El paso de inicio de sesión salió bien en las pruebas. La gente lo terminó en menos de un minuto.', de: 'Die Anmeldung hat im Test gut abgeschnitten. Die Leute waren in unter einer Minute fertig.', ja: 'サインインのステップはテストで好評でした。皆1分以内に完了しました。' } },
  { who: 'diego', lang: 'es', t: { es: 'Entonces propongo lanzar el 18 de noviembre, no el 11.', en: 'Then I propose we launch on November 18, not the 11th.', de: 'Dann schlage ich vor, am 18. November zu starten, nicht am 11.', ja: 'それなら、11日ではなく11月18日のリリースを提案します。' } },
  { who: 'theo', lang: 'en', t: { en: 'Agreed. The 18th gives support a full week with the new help pages.', es: 'De acuerdo. El 18 le da a soporte una semana entera con las nuevas páginas de ayuda.', de: 'Einverstanden. Mit dem 18. hat der Support eine volle Woche mit den neuen Hilfeseiten.', ja: '賛成です。18日なら、サポートが新しいヘルプページで丸1週間準備できます。' } },
  { who: 'lena', lang: 'de', t: { de: 'Ich schreibe die Hilfeseiten bis Freitag.', en: 'I’ll write the help pages by Friday.', es: 'Yo escribo las páginas de ayuda para el viernes.', ja: 'ヘルプページは金曜日までに私が書きます。' } },
  { who: 'priya', lang: 'en', t: { en: 'Can we keep the old pricing page until the launch? Changing both at once is a lot.', es: '¿Podemos mantener la página de precios actual hasta el lanzamiento?', de: 'Können wir die alte Preisseite bis zum Start behalten?', ja: 'リリースまでは今の料金ページのままにできますか？' } },
  { who: 'kofi', lang: 'en', t: { en: 'Yes. Pricing moves after the launch, and I’ll draft the new page in December.', es: 'Sí. Los precios cambian después del lanzamiento, y yo preparo la página nueva en diciembre.', de: 'Ja. Die Preise ändern wir nach dem Start, und ich entwerfe die neue Seite im Dezember.', ja: 'はい。料金はリリース後に変更し、新しいページは12月に私が下書きします。' } },
  { who: 'diego', lang: 'es', t: { es: 'Sí, el lunes comparto los números con todos.', en: 'Yes, I’ll share the numbers with everyone on Monday.', de: 'Ja, am Montag teile ich die Zahlen mit allen.', ja: 'はい、月曜日に数字を皆に共有します。' } },
  { who: 'lena', lang: 'de', t: { de: 'Dann sind wir für den Start bereit.', en: 'Then we’re ready for the launch.', es: 'Entonces estamos listos para el lanzamiento.', ja: 'それならリリースの準備は整いました。' } }
];

const EMPTY: PreviewSnapshot = { people: [], speaking: null, caption: null, spotlight: null, rooms: null };

/** The preview's people and what they're doing, as one live store: the stage reads it with useLive(). */
export class MultipartyPreview implements LiveStore<PreviewSnapshot> {
  private snap: PreviewSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private line = 0;
  private tick = 0;

  getSnapshot = (): PreviewSnapshot => this.snap;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<PreviewSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach((l) => l()); }

  start() {
    if (this.timers.length) return;
    this.set({ people: PEOPLE.map((id) => ({ id: `${PREVIEW_PREFIX}${id}`, person: personOf(id), mic: id !== 'lena', hand: false })) });
    this.timers.push(setInterval(() => this.say(), 5200));
    // Someone raises a hand now and then, and lowers it again.
    this.timers.push(setInterval(() => {
      const who = `${PREVIEW_PREFIX}${PEOPLE[(this.tick++ % 3) + 1] ?? 'priya'}`;
      this.set({ people: this.snap.people.map((p) => ({ ...p, hand: p.id === who ? !p.hand : false })) });
    }, 41_000));
    this.say();
  }
  stop() { this.timers.forEach((t) => clearInterval(t)); this.timers = []; this.snap = EMPTY; }

  private say() {
    const l = SCRIPT[this.line++ % SCRIPT.length];
    if (!l) return;
    const id = `${PREVIEW_PREFIX}${l.who}`;
    const rooms = this.snap.rooms;
    if (rooms) {
      // In rooms, each room talks among itself; you hear the room you're in.
      const talking = rooms.assign.map((ids, k) => ids[(this.line + k) % Math.max(1, ids.length)] ?? null);
      const notes = rooms.notes.map((n, k) => (k === this.line % rooms.assign.length && n < 3 ? n + 1 : n));
      const here = rooms.joined === null ? null : talking[rooms.joined] ?? null;
      this.set({ rooms: { ...rooms, talking, notes }, speaking: here, caption: null });
      return;
    }
    this.set({
      speaking: id, caption: { id: `${id}:${this.line}`, who: id, lang: l.lang, text: l.t },
      people: this.snap.people.map((p) => (p.id === id ? { ...p, mic: true } : p.id === `${PREVIEW_PREFIX}lena` ? { ...p, mic: false } : p))
    });
  }

  setSpotlight(id: string | null) { this.set({ spotlight: id }); }
  setHand(id: string, up: boolean) { this.set({ people: this.snap.people.map((p) => (p.id === id ? { ...p, hand: up } : p)) }); }
  openRooms(assign: string[][]) {
    this.set({ rooms: { assign, talking: assign.map((ids) => ids[0] ?? null), notes: assign.map(() => 0), help: null, joined: null }, spotlight: null, caption: null, speaking: null });
    // A little while in, someone in the last room asks for help.
    this.timers.push(setTimeout(() => {
      const r = this.snap.rooms;
      const last = r ? r.assign.length - 1 : -1;
      const who = r?.assign[last]?.[0];
      if (r && who && r.joined !== last) this.set({ rooms: { ...r, help: { room: last, id: who } } });
    }, 6000));
  }
  joinRoom(room: number | null) {
    const r = this.snap.rooms;
    if (!r) return;
    this.set({ rooms: { ...r, joined: room, help: r.help && r.help.room === room ? null : r.help } });
  }
  closeRooms() { this.set({ rooms: null }); }
}
