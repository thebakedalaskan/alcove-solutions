/*
 * Captions: the live transcript's newest line, in your language if you chose one. Lines are
 * translated in confidential compute for you alone (CallSession.translate), a few at a time, and
 * each is asked for once per language. Turning captions off only hides them: the call is still
 * transcribed for notes while notes are on.
 */
import { CAPTION_LANGUAGES, type CallSession, type CaptionLanguage, type TranscriptLine } from '@alcove/api';
import type { useToast } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import { log } from '~/lib/log';

const clog = log.child({ component: 'captions' });

export interface LiveCaption { line: TranscriptLine; text: string; translated: boolean; arrived: number }

export function useCaptions(session: CallSession, lines: TranscriptLine[], language: CaptionLanguage | null, on: boolean): LiveCaption | null {
  const cache = useRef(new Map<string, string>());
  const asked = useRef(new Set<string>());
  const arrived = useRef(new Map<string, number>());
  const [, setTick] = useState(0);
  const last = lines.at(-1);
  if (last && !arrived.current.has(last.id)) arrived.current.set(last.id, Date.now());

  useEffect(() => {
    if (!on || !language) return;
    // The newest few lines not asked for yet in this language, so a caption never waits on old ones.
    const want = lines.slice(-4).filter((l) => !asked.current.has(`${language}:${l.id}`));
    if (!want.length) return;
    want.forEach((l) => asked.current.add(`${language}:${l.id}`));
    let alive = true;
    session.translate(want.map((l) => l.id), language).then((got) => {
      for (const t of got) cache.current.set(`${language}:${t.id}`, t.text);
      if (alive) setTick((n) => n + 1);
    }, (e: unknown) => {
      clog.warn('captions not translated', { err: e, language, lines: want.length });
      // Asked again with the next line.
      want.forEach((l) => asked.current.delete(`${language}:${l.id}`));
    });
    return () => { alive = false; };
  }, [session, lines, language, on]);

  if (!last) return null;
  const t = language ? cache.current.get(`${language}:${last.id}`) : undefined;
  return { line: last, text: t ?? last.text, translated: t !== undefined && t !== last.text, arrived: arrived.current.get(last.id) ?? Date.now() };
}

/**
 * Captions in the call, for you alone: whether they're on (`on`, turned on or off by `flip`, which says so), in which language
 * (`pick`, which says so too), and the line they show now. They show the lines of the part of the call you're in, while it's live.
 */
export function useCallCaptions({ session, lines, live, toast }: { session: CallSession; lines: TranscriptLine[]; live: boolean; toast: ReturnType<typeof useToast> }) {
  const [cc, setCc] = useState(false);
  const [lang, setLang] = useState<CaptionLanguage | null>(null);
  const caption = useCaptions(session, lines, lang, cc && live);
  const flip = () => {
    const v = !cc;
    setCc(v);
    toast(v ? `Captions on${lang ? `, in ${CAPTION_LANGUAGES.find((x) => x.code === lang)?.english ?? lang}` : ''}` : 'Captions off. The call is still transcribed for notes.', { icon: 'captions' });
  };
  const pick = (code: CaptionLanguage | null) => {
    setLang(code);
    const info = CAPTION_LANGUAGES.find((x) => x.code === code);
    toast(code ? `Captions in ${info?.english ?? code} for you` : 'Captions as they’re spoken', { icon: 'translate' });
  };
  return { on: cc, language: lang, caption, flip, pick };
}
export type CallCaptions = ReturnType<typeof useCallCaptions>;
