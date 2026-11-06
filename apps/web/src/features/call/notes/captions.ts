/*
 * Captions: the live transcript's newest line, in your language if you chose one. Lines are
 * translated in confidential compute for you alone (CallSession.translate), a few at a time, and
 * each is asked for once per language. Turning captions off only hides them: the call is still
 * transcribed for notes while notes are on.
 */
import type { CallSession, CaptionLanguage, TranscriptLine } from '@alcove/api';
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
