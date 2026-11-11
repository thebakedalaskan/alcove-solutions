/*
 * Before the first notes there's nothing to search, so the job is to get some: Start a call takes the middle of the sky,
 * and an example on the water shows what they'll look like.
 */
import type { Person } from '@alcove/api';
import { Avatar, Button, Chip, Evening, Faces, Icon, buttonClass, cn } from '@alcove/ui';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { exampleNote } from '~/features/notes/example';
import { peopleLine } from '~/features/notes/meta';
import { useCallFlow } from '~/features/shell/context';
import { position } from '~/lib/time';

const EXAMPLE = { to: '/notes/$noteId', params: { noteId: 'example' } } as const;

/** A moment in the example: it opens the example, which has no recording to wait at. */
const Moment = ({ at }: { at: number }) => (
  <Link {...EXAMPLE} className="hm-moment" aria-label={`Open the example at ${position(at)}`}><Icon name="moment" size={13} />{position(at)}</Link>
);

function Example({ me }: { me: Person }) {
  const note = exampleNote(me);
  const decision = note.decisions[0];
  const action = note.actions[0];
  const line = note.questions[0]?.evidence.moments[0];
  return (
    <section className="nt-ex" aria-label="An example note" style={{ '--d': 2 }}>
      <div className="nt-ex-card">
        <div className="nt-ex-b">
          <div className="nt-ex-top">
            <Chip className="nt-st">Example</Chip>
            <Link {...EXAMPLE} className={cn(buttonClass({ variant: 'quiet', size: 'sm' }), 'nt-ex-open')}>Open the example<Icon name="right" size={14} /></Link>
          </div>
          <h2 className="nt-pv-t">{note.title}</h2>
          <div className="nt-pv-m"><span>{Math.round(note.duration / 60)} min</span><span className="nt-whob"><Faces people={note.people} size={22} max={4} /><span>{peopleLine(note.people, me.email)}</span></span></div>
          <p className="nt-pv-s">{note.summary}</p>
          {line?.kind === 'line' && <div className="nt-said"><p className="nt-said-t"><b>{line.speaker?.name.split(' ')[0]}</b>{line.text}</p><Moment at={line.at} /></div>}
        </div>
        <div className="hm-tiles nt-ex-t">
          {decision && (
            <article className="hm-tile is-decide">
              <div className="hm-tile-h"><span className="hm-tile-i"><Icon name="badgeCheck" size={16} /></span><span className="hm-tile-k">Decision</span>{decision.at !== undefined && <Moment at={decision.at} />}</div>
              <p className="hm-tile-t">{decision.text}</p>
              <div className="hm-tile-a hm-done"><Icon name="check" size={15} /><span>Confirmed by {decision.changes[0]?.by.name.split(' ')[0]}</span></div>
            </article>
          )}
          {action && (
            <article className="hm-tile">
              <div className="hm-tile-h"><span className="hm-tile-i"><Icon name="userCheck" size={16} /></span><span className="hm-tile-k">Follow-up</span>{action.at !== undefined && <Moment at={action.at} />}</div>
              <p className="hm-tile-t">{action.text}</p>
              <div className="hm-tile-a nt-ex-who"><Avatar person={action.owner?.person ?? { name: action.owner?.name ?? '' }} size={22} /><span>{action.owner?.name.split(' ')[0]}, {action.due}</span></div>
            </article>
          )}
        </div>
      </div>
      <p className="nt-ex-cap"><Icon name="sealed" size={15} />Written by an AI model in confidential compute.</p>
    </section>
  );
}

export function FirstDay({ me }: { me: Person | undefined }) {
  const flow = useCallFlow();
  const h = useId();
  return (
    <Evening moment="notes" className="nt" data-first>
      <header className="dusk-top" style={{ '--d': 0 }}><h1 className="dusk-title">Notes</h1></header>
      <section className="nt-sky is-first" aria-labelledby={h} style={{ '--d': 1 }}>
        <h2 id={h} className="nt-hero">No notes yet</h2>
        <div className="nt-go">
          <Button variant="primary" size="lg" icon="video" onClick={() => flow.start()}>Start a call</Button>
          <Link to="/record" className={cn(buttonClass({ size: 'lg' }), 'nt-sky-b')}><Icon name="recordDot" size={18} />Record in the room</Link>
        </div>
      </section>
      {me && <Example me={me} />}
    </Evening>
  );
}
