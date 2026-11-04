/* The live transcript as it's written, on the call stage and in the room: the newest line at the bottom. */
import type { CaptureGap, Speaker, TranscriptLine } from '@alcove/api';
import { Avatar, CaptureGapMark, Icon, TimeChip, cn } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gapLabel, gapsAfter, gapsBefore } from '~/lib/capture';
import { spokenName } from '~/lib/people';
import { position } from '~/lib/time';

/**
 * Keeps a list scrolled to its newest line, unless the person has scrolled up to read. Only scrolling
 * up counts as reading back: new lines, a resized window and the glide after "Latest" never do.
 */
function useFollow(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = useRef(0);
  const [away, setAway] = useState(false);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [count]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) pinned.current = true;
    else if (el.scrollTop < last.current) pinned.current = false;
    last.current = el.scrollTop;
    setAway(!pinned.current);
  };
  const jump = () => {
    const el = ref.current;
    if (!el) return;
    pinned.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  };
  return { ref, onScroll, away, jump };
}

/** Lines already there when the list appears stay still; the ones that arrive after rise in. */
function useArrivals(lines: TranscriptLine[]): (id: string) => boolean {
  const [first] = useState(() => new Set(lines.map((l) => l.id)));
  return (id) => !first.has(id);
}

const Latest = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="tx-latest" onClick={onClick}><Icon name="down" size={14} />Latest</button>
);

const who = (s: Speaker | undefined) => (s ? (s.person?.email.toLowerCase() ?? `name:${s.name}`) : '');

/** Lines that start a group: a new speaker, or the same one a minute on, so a time is never far away. */
function groupStarts(lines: TranscriptLine[]): Set<string> {
  const starts = new Set<string>();
  let speaker: string | null = null;
  let since = 0;
  for (const l of lines) {
    const k = who(l.speaker);
    if (k === speaker && l.at - since < 60) continue;
    starts.add(l.id);
    speaker = k;
    since = l.at;
  }
  return starts;
}

/** Where nothing was captured, in its place between the lines. */
const Gap = ({ g }: { g: CaptureGap }) => <CaptureGapMark label={gapLabel(g)} detail={g.to ? 'Nothing was recorded' : 'Nothing is being recorded'} />;

/**
 * A call's transcript: who spoke ("You" for the reader) and what they said, with the stretches nothing was captured
 * in marked where they fall. Each new `hit` (seconds into the recording) scrolls to the line said then and marks it
 * for a moment, for a time chip that points here.
 */
export function CallLines({ lines, gaps = [], me, hit = null }: { lines: TranscriptLine[]; gaps?: CaptureGap[] | undefined; me: string | undefined; hit?: { at: number } | null | undefined }) {
  const { ref, onScroll, away, jump } = useFollow(lines.length + gaps.length);
  const arrived = useArrivals(lines);
  const starts = groupStarts(lines);
  const reduce = useReducedMotion();
  const [marked, setMarked] = useState<string | null>(null);
  useEffect(() => {
    if (hit === null) return;
    const line = [...lines].reverse().find((l) => l.at <= hit.at + 0.5) ?? lines[0];
    if (!line) return;
    setMarked(line.id);
    ref.current?.querySelector(`[data-line="${line.id}"]`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    const t = setTimeout(() => setMarked(null), 2200);
    return () => clearTimeout(t);
    // Only a new jump moves the list; new lines arriving don't.
  }, [hit]);
  return (
    <div className="tx-wrap">
      <div ref={ref} className="tx" onScroll={onScroll} role="log" aria-label="What’s been said">
        {lines.map((l, i) => {
          const before = gapsBefore(gaps, lines, i);
          // After a gap the speaker is named again: it's a new part of the call.
          const start = starts.has(l.id) || before.length > 0;
          return (
            <Fragment key={l.id}>
              {before.map((g) => <Gap key={`${g.kind}-${g.from}`} g={g} />)}
              <div data-line={l.id} className={cn('tx-l', start && 'tx-start', arrived(l.id) && 'tx-in', marked === l.id && 'is-hit')}>
                {start && l.speaker ? <Avatar person={l.speaker.person ?? { name: l.speaker.name }} size={26} /> : <span />}
                <div className="min-w-0">
                  {start && <div className="tx-h">{l.speaker && <b>{spokenName(l.speaker, me)}</b>}<span className="ac-mono">{position(l.at)}</span></div>}
                  <p>{l.text}</p>
                </div>
              </div>
            </Fragment>
          );
        })}
        {gapsAfter(gaps, lines).map((g) => <Gap key={`${g.kind}-${g.from}`} g={g} />)}
      </div>
      {away && <Latest onClick={jump} />}
    </div>
  );
}

/** A room recording's transcript: nobody is named, so each line has its time. */
export function RoomLines({ lines }: { lines: TranscriptLine[] }) {
  const { ref, onScroll, away, jump } = useFollow(lines.length);
  const arrived = useArrivals(lines);
  return (
    <div className="tx-wrap">
      <div ref={ref} className="rm-lines" onScroll={onScroll} role="log" aria-label="What’s been said">
        {lines.map((l) => <div key={l.id} className={cn('rm-line', arrived(l.id) && 'tx-in')}><TimeChip seconds={l.at} /><p>{l.text}</p></div>)}
      </div>
      {away && <Latest onClick={jump} />}
    </div>
  );
}
