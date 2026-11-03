/*
 * The note card from the welcome screen: a call's notes writing themselves. It carries through
 * sign-in and lands on Home as the example of what notes look like.
 */
import { Avatar, CheckDraw, Chip, Faces, Icon, Words, cn, type AvatarPerson } from '@alcove/ui';

/** The promise, in the same words everywhere. */
export const PROMISE = 'Written privately. Alcove can’t read it.';
export const PROMISE_MANY = 'Written privately. Alcove can’t read them.';

/** The three people in the example call. Illustrated, so they can't be mistaken for real users. */
export const CAST = {
  theo: { name: 'Theo Martin', portrait: { skin: '#E8C2A0', hair: '#5B3B25', style: 'short', shirt: '#2E3A8C', bg: '#D5DEFF', beard: true } },
  priya: { name: 'Priya Raman', portrait: { skin: '#B47A55', hair: '#1A120E', style: 'bun', shirt: '#9C4A86', bg: '#F8D6E4', earrings: true } },
  kofi: { name: 'Kofi Asante', portrait: { skin: '#7B4F35', hair: '#141010', style: 'buzz', shirt: '#3D35A8', bg: '#FFE1C4', glasses: true } }
} satisfies Record<string, AvatarPerson>;

export const EXAMPLE_SUMMARY = 'Sign-ups are back up, and the launch moves to the 18th.';

export interface NoteCardProgress {
  decided: boolean;
  followUp: boolean;
  /** none: a placeholder line. writing: the words write themselves in. done: shown as is. */
  summary: 'none' | 'writing' | 'done';
  ready: boolean;
}
export const CARD_DONE: NoteCardProgress = { decided: true, followUp: true, summary: 'done', ready: true };

export function NoteCard({ progress, you, example = false, className }: {
  progress: NoteCardProgress;
  /** The signed-in person, who joins the call's people once they've signed in. */
  you?: AvatarPerson | null | undefined;
  example?: boolean;
  className?: string;
}) {
  const youFirst = you ? (you.name.split(' ')[0] ?? you.name) : 'you';
  return (
    <div className={cn('note-card', className)}>
      <div className="nc-h">
        <div><div className="nc-title">Weekly product call</div><div className="nc-sub">Today · 24 min</div></div>
        {example ? <Chip tone="accent">Example</Chip>
          : progress.ready ? <Chip tone="accent" icon="check" className="nc-state">Ready</Chip>
            : <Chip tone="rec" className="nc-state">Writing</Chip>}
      </div>
      <div className="nc-who">
        <Faces people={[CAST.theo, CAST.priya, CAST.kofi]} size={26} />
        <span className={cn('nc-you', you && 'on')}>{you ? <Avatar person={you} size={26} /> : <span className="av" style={{ '--s': '26px' }} />}</span>
        <span className="nc-who-t">Theo, Priya, Kofi and <b>{youFirst}</b></span>
      </div>
      <div className="nc-blur">
        <div className="nc-sec">
          <div className="nc-label">Summary</div>
          <div className="nc-sum">
            {progress.summary === 'none' ? <div className="nc-line"><span className="ph" /></div>
              : progress.summary === 'writing' ? <Words text={EXAMPLE_SUMMARY} /> : EXAMPLE_SUMMARY}
          </div>
        </div>
        <div className="nc-sec">
          <div className="nc-label">Decided</div>
          <div className={cn('nc-line nc-d1', progress.decided && 'on')}>
            <span className="ph" />
            <span className="txt"><span className="tk"><CheckDraw done={progress.decided} size={11} /></span>Launch moves to the 18th.</span>
          </div>
        </div>
        <div className="nc-sec">
          <div className="nc-label">Follow-ups</div>
          <div className={cn('nc-line nc-f1', progress.followUp && 'on')}>
            <span className="ph s" />
            <span className="txt"><span className="own"><Avatar person={CAST.kofi} size={18} />Kofi</span>Send the new screens · Wed</span>
          </div>
        </div>
      </div>
      <div className={cn('nc-foot', progress.ready && 'on')}><Icon name="lock" size={14} /><span className="nc-foot-t">{PROMISE}</span></div>
    </div>
  );
}
