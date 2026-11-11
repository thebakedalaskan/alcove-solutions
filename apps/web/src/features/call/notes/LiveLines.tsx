/* The live transcript as it's written, on the call stage and in the room: the newest line at the bottom. */
import type { CaptureGap, Speaker, TranscriptLine } from '@alcove/api';
import { Avatar, CaptureGapMark, Icon, IconButton, Unsure, UnsureKey, WsPutArrow, cn } from '@alcove/ui';
import { useReducedMotion } from 'motion/react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LineMarks } from '~/features/notes/lines';
import { gapLabel, gapsAfter, gapsBefore } from '~/lib/capture';
import { spokenName } from '~/lib/people';
import { position } from '~/lib/time';

/**
 * Keeps a list scrolled to its newest line, unless the person has scrolled up to read. Only scrolling
 * up counts as reading back: new lines, a resized window and the glide after "Latest" never do.
 * `newest` changes with every new line: a count wouldn't, once the list has reached its cap and the oldest line goes as
 * each new one comes. `glide`: each new line slides the list up, instead of the list jumping to it. `still`: it starts
 * wherever it's put, for a list opened at a moment, and follows once someone comes down to the end.
 */
export function useFollow(newest: string, glide = false, still = false) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(!still);
  const last = useRef(0);
  const [away, setAway] = useState(false);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: glide && !reduce ? 'smooth' : 'auto' });
  }, [newest, glide, reduce]);
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

/** One key per person: guests (and everyone, to a guest) have no email, so the person's ID tells them apart. */
const who = (s: Speaker | undefined) => (s ? (s.person?.id ?? `name:${s.name}`) : '');

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
 * in marked where they fall, and what it isn't sure of dotted (words hard to hear, a line heard on two microphones),
 * explained once at the top. `marks` bookmarks a line in the reader's own notes, or takes it back, as on the note, and
 * `quote` sends one into a document. `when` says when a line was said, which is how far in unless it says otherwise.
 */
export function CallLines({ lines, gaps = [], me, marks, quote, when = position }: {
  lines: TranscriptLine[]; gaps?: CaptureGap[] | undefined; me: string | undefined; marks?: LineMarks | undefined;
  quote?: { target: string; onQuote: (line: TranscriptLine) => void } | null | undefined;
  when?: ((at: number) => string) | undefined;
}) {
  const { ref, onScroll, away, jump } = useFollow(`${lines.length}:${lines.at(-1)?.id}:${gaps.length}`);
  const arrived = useArrivals(lines);
  const starts = groupStarts(lines);
  return (
    <div className="tx-wrap">
      <div ref={ref} className="tx" onScroll={onScroll} role="log" aria-label="What’s been said">
        <UnsureKey words={lines.some((l) => l.unsure?.words)} speaker={lines.some((l) => l.unsure?.speaker)} className="tx-key" />
        {lines.map((l, i) => {
          const before = gapsBefore(gaps, lines, i);
          // After a gap the speaker is named again: it's a new part of the call, and so is a speaker in doubt.
          const start = starts.has(l.id) || before.length > 0 || !!l.unsure?.speaker;
          const marked = marks?.has(l.id) ?? false;
          return (
            <Fragment key={l.id}>
              {before.map((g) => <Gap key={`${g.kind}-${g.from}`} g={g} />)}
              <div className={cn('tx-l', start && 'tx-start', arrived(l.id) && 'tx-in', marks && 'has-mark', quote && 'has-put')}>
                {start && l.speaker ? <Avatar person={l.speaker.person ?? { name: l.speaker.name }} size={26} /> : <span />}
                <div className="min-w-0">
                  {start && (
                    <div className="tx-h">
                      {l.speaker && <b>{l.unsure?.speaker ? <Unsure of="speaker">{spokenName(l.speaker, me)}</Unsure> : spokenName(l.speaker, me)}</b>}
                      <span className="ac-mono">{when(l.at)}</span>
                    </div>
                  )}
                  <p>{l.unsure?.words ? <Unsure of="words">{l.text}</Unsure> : l.text}</p>
                </div>
                {quote && <WsPutArrow verb="Quote in" target={quote.target} onPut={() => quote.onQuote(l)} />}
                {marks && <IconButton icon={marked ? 'bookmarked' : 'bookmark'} label={marked ? 'Remove your bookmark' : 'Bookmark this line in your own notes, which only you see'} size={14} className="tx-mark" on={marked} onClick={() => marks.toggle(l)} />}
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

/**
 * A room recording's transcript under the voice: nobody is named. The last three lines show, fading as they get older, and
 * scrolling up reads back the rest. A line's time is on it for anyone who wants it.
 */
export function RoomLines({ lines }: { lines: TranscriptLine[] }) {
  const { ref, onScroll, away, jump } = useFollow(`${lines.length}:${lines.at(-1)?.id}`, true);
  const arrived = useArrivals(lines);
  return (
    <div className="tx-wrap">
      <div ref={ref} className={cn('rec-lines', away && 'is-back')} onScroll={onScroll} role="log" aria-label="What’s been said">
        <UnsureKey words={lines.some((l) => l.unsure?.words)} speaker={false} className="tx-key" />
        {lines.map((l, i) => (
          <p key={l.id} title={position(l.at)} className={cn('rec-l', `a${Math.min(lines.length - 1 - i, 3)}`, arrived(l.id) && 'is-in')}>
            {l.unsure?.words ? <Unsure of="words">{l.text}</Unsure> : l.text}
          </p>
        ))}
      </div>
      {away && <Latest onClick={jump} />}
    </div>
  );
}
