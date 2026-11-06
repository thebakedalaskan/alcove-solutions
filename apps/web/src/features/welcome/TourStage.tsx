/*
 * The call the tour plays on, drawn at 1120 × 700 and always night: the people in it, the dock, the panels and menus
 * each step opens, the rooms, the workspace, and the pointer that shows each click. It draws whatever `Stage` says;
 * tourSteps.ts says what changes when. Anything the pointer goes to is marked `data-at`, and each menu `data-pop`.
 */
import {
  Avatar, Button, CallDock, CallTile, Caption, Chip, DockButton, DockLeave, DockSeparator, EASE, Faces, Icon, NotesSign, PointerTag,
  SealedBadge, SharePointer, TimeChip, cn, type IconName
} from '@alcove/ui';
import { AnimatePresence, motion } from 'motion/react';
import { Fragment, type ReactNode } from 'react';
import { CAST, firstOf } from '~/features/notes/cast';
import {
  DOC_LINE, LAYOUTS, LINES, LINKS, ORDER, ROOMS, SUMMARY, alcoveX, clock, shareAt, type Box, type PopId, type Stage, type Who
} from './tourSteps';

const nameOf = (id: Who) => (id === 'art' ? 'You' : firstOf(id));
/** How big someone's arch is in their tile: a face in the middle of a tile, or the whole of an arch. */
const faceSize = (b: Box) => Math.round((b.arch ? b.w : Math.min(b.w * 0.36, (b.h * 0.6) / 1.08, 190)) * 10) / 10;
const STATUS: Partial<Record<Who, { icon: IconName; text: string }>> = {
  maya: { icon: 'listening', text: 'Listening only' },
  art: { icon: 'away', text: 'Be right back · 14:37' }
};
const BOARD_TOOLS: readonly IconName[] = ['pointer', 'stickyNote', 'board', 'connector', 'type', 'pen'];
const GLIDE = { duration: 0.8, ease: EASE.inOut };

/** Words that appear one at a time: the first `shown` are in. */
function Written({ text, shown }: { text: string; shown: number }) {
  const ws = text.split(' ');
  return ws.map((w, i) => (
    <Fragment key={`${i}-${w}`}>
      <span className={cn('lp-st-w', i >= shown && 'is-off')}>{w}</span>{i < ws.length - 1 ? ' ' : ''}
    </Fragment>
  ));
}

function Top({ s }: { s: Stage }) {
  return (
    <div className="lp-st-top">
      <span className="lp-st-title">Launch planning</span>
      <span className="lp-st-clock">14:32</span>
      <NotesSign stage>Notes on</NotesSign>
      <div className="lp-st-end">
        <span className={cn('lp-st-tb', s.hi.includes('viewBtn') && 'is-hi')} data-at="view"><Icon name="layout" size={16} />View</span>
        <span className="lp-st-tb is-sealed"><Icon name="sealed" size={16} /></span>
        <Faces people={[CAST.priya, CAST.kofi, CAST.aiko, CAST.maya]} size={22} />
        <span className="lp-st-count">6</span>
      </div>
    </div>
  );
}

function Tiles({ s }: { s: Stage }) {
  return ORDER.map((id) => {
    const b = LAYOUTS[s.layout][id];
    const status = STATUS[id];
    return (
      <div key={id} className={cn('lp-st-tile', b.arch && 'is-arch', s.hover === id && 'is-hover', id === 'art' && s.away && 'is-away', b.arch && s.speaking === id && 'is-up', !b.arch && b.h < 100 && 'is-short')}
        style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
        <CallTile person={CAST[id]} name={nameOf(id)} speaking={s.speaking === id} muted={s.muted.includes(id)}
          chrome={(
            <>
              {status && <span className={cn('lp-st-status', s.status.includes(id) && 'is-on')}><Icon name={status.icon} size={14} />{status.text}</span>}
              {id === 'art' && (
                <>
                  <span className="lp-st-left"><i /></span>
                  <span className={cn('lp-st-mute', s.onMute && 'is-on')}>
                    <Icon name="micOff" size={15} /><span>You’re talking on mute</span><span className="lp-st-unmute" data-at="unmute">Unmute</span>
                  </span>
                </>
              )}
              <span className="lp-st-more" data-at={`more:${id}`}><Icon name="more" size={16} /></span>
            </>
          )}>
          <span className="lp-st-face"><Avatar person={CAST[id]} size={faceSize(b)} /></span>
        </CallTile>
      </div>
    );
  });
}

/** Kofi's design file, shared to the call (illustration). */
function SharedScreen() {
  return (
    <svg viewBox="0 0 700 440" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="lp-st-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#AFC6E9" /><stop offset=".6" stopColor="#D0D3EE" /><stop offset="1" stopColor="#F2CFD6" /></linearGradient>
        <linearGradient id="lp-st-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#CFD3EC" /><stop offset="1" stopColor="#B8CBE8" /></linearGradient>
      </defs>
      <rect width="700" height="440" fill="#E6ECF4" />
      <rect width="700" height="38" fill="#FFFFFF" />
      <circle cx="20" cy="19" r="5" fill="#D9E1E9" /><circle cx="36" cy="19" r="5" fill="#D9E1E9" /><circle cx="52" cy="19" r="5" fill="#D9E1E9" />
      <rect x="270" y="11" width="160" height="16" rx="8" fill="#EEF2F7" />
      <rect y="38" width="140" height="402" fill="#FFFFFF" />
      <rect x="16" y="58" width="80" height="8" rx="4" fill="#C7D1DD" />
      <rect x="16" y="80" width="100" height="8" rx="4" fill="#DCE3EC" />
      <rect x="16" y="98" width="90" height="8" rx="4" fill="#DCE3EC" />
      <rect x="16" y="116" width="96" height="8" rx="4" fill="#8EB0E0" />
      <rect x="16" y="134" width="70" height="8" rx="4" fill="#DCE3EC" />
      <g transform="translate(176 70)">
        <rect width="480" height="300" rx="12" fill="#F3F7FC" />
        <rect width="96" height="300" rx="12" fill="#09172C" />
        <rect x="84" width="12" height="300" fill="#09172C" />
        <rect x="16" y="20" width="44" height="8" rx="4" fill="#F7F3EB" opacity=".8" />
        <rect x="16" y="44" width="64" height="18" rx="9" fill="#F6E8CC" opacity=".25" />
        <rect x="16" y="76" width="54" height="7" rx="3.5" fill="#BFCAD7" opacity=".6" />
        <rect x="16" y="94" width="48" height="7" rx="3.5" fill="#BFCAD7" opacity=".45" />
        <rect x="16" y="112" width="58" height="7" rx="3.5" fill="#BFCAD7" opacity=".45" />
        <rect x="96" width="384" height="172" fill="url(#lp-st-sky)" />
        <rect x="96" y="172" width="384" height="128" fill="url(#lp-st-sea)" />
        <circle cx="288" cy="172" r="22" fill="#FFE29E" />
        <rect x="96" y="171" width="384" height="2" fill="#FFD9A0" opacity=".8" />
        <rect x="226" y="86" width="124" height="14" rx="7" fill="#12223F" opacity=".78" />
        <rect x="250" y="114" width="76" height="22" rx="11" fill="#153166" />
        <rect x="262" y="183" width="52" height="3" rx="1.5" fill="#FFD9A0" />
        <rect x="272" y="192" width="32" height="3" rx="1.5" fill="#FFD9A0" opacity=".6" />
        <rect x="120" y="212" width="216" height="64" rx="10" fill="#FCFDFE" opacity=".95" />
        <rect x="348" y="212" width="112" height="64" rx="10" fill="#FCFDFE" opacity=".95" />
        <rect x="134" y="226" width="80" height="7" rx="3.5" fill="#B1366B" opacity=".7" />
        <rect x="134" y="242" width="160" height="6" rx="3" fill="#C7D1DD" />
        <rect x="134" y="256" width="120" height="6" rx="3" fill="#C7D1DD" />
        <rect x="362" y="226" width="60" height="7" rx="3.5" fill="#215DB3" opacity=".7" />
        <rect x="362" y="242" width="84" height="6" rx="3" fill="#C7D1DD" />
      </g>
      <rect x="176" y="382" width="140" height="8" rx="4" fill="#C7D1DD" />
    </svg>
  );
}

function Share({ s }: { s: Stage }) {
  const b = shareAt(s.layout);
  return (
    <div className={cn('lp-st-share', s.share && 'is-on')} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
      <SharedScreen />
      <span className="lp-st-share-tag"><Avatar person={CAST.kofi} size={18} />Kofi’s screen</span>
    </div>
  );
}

function Msg({ who, at, children, more, className }: { who: Who; at: string; children: ReactNode; more?: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('lp-st-msg', className)}>
      <Avatar person={CAST[who]} size={24} />
      <div><b>{nameOf(who)}<span>{at}</span></b><p>{children}</p>{more}</div>
    </div>
  );
}

function Todo({ done = false, who, children }: { done?: boolean; who: Who; children: ReactNode }) {
  return (
    <div className="lp-st-todo">
      <span className={cn('lp-st-box', done && 'is-on')}><Icon name="check" size={13} /></span>
      <span>{children}</span>
      <span className="lp-st-todo-who"><Avatar person={CAST[who]} size={18} />{nameOf(who)}</span>
    </div>
  );
}

/** The workspace, open in the call: the launch plan, and the board beside it. */
function Workspace({ s }: { s: Stage }) {
  const w = s.work;
  return (
    <div className={cn('lp-st-ws', w.on && 'is-on')}>
      <div className="lp-st-ws-top">
        <span className={cn('lp-st-ws-tab', !w.board && 'is-on')}><Icon name="fileText" size={15} />Launch plan</span>
        <span className={cn('lp-st-ws-tab', w.board && 'is-on', s.hi.includes('ws:board') && 'is-hi')} data-at="ws:board"><Icon name="board" size={15} />Onboarding flow</span>
        <Faces people={[CAST.priya, CAST.kofi, CAST.maya, CAST.aiko]} size={22} />
        <span className="lp-st-ws-live"><i />4 editing</span>
      </div>
      <div className={cn('lp-st-ws-view', !w.board && 'is-on')}>
        <div className="lp-st-doc">
          <div className="lp-st-doc-title">Launch plan</div>
          <div className="lp-st-doc-by">Worked on in Launch planning · today</div>
          <div className="lp-st-doc-h">What ships</div>
          <p>The new onboarding, behind a flag, on <span className="lp-st-mark">Wed 18 November</span>. Support gets the help article first.</p>
          <div className="lp-st-doc-h">Before launch</div>
          <Todo done who="maya">Pricing page copy</Todo>
          <Todo who="kofi">Final onboarding screens</Todo>
          <Todo who="aiko">{DOC_LINE.slice(0, w.typed)}<span className="lp-st-rcaret"><PointerTag person={CAST.priya} name="Priya" /></span></Todo>
        </div>
        <div className={cn('lp-st-comment', w.comment && 'is-on')}>
          <Msg who="kofi" at="14:41">Moved from the 12th, so support has the article a week ahead.</Msg>
        </div>
      </div>
      <div className={cn('lp-st-ws-view', w.board && 'is-on')}>
        <div className="lp-st-board">
          <svg className="lp-st-links" viewBox="0 0 900 504" preserveAspectRatio="none" aria-hidden="true">
            {LINKS.map((d, i) => <path key={d} d={d} pathLength={1} className={cn(w.drawn > i && 'is-on')} />)}
          </svg>
          <div className="lp-st-shape" style={{ left: 76, top: 60, width: 120 }}>Sign in</div>
          <div className="lp-st-shape is-ask" style={{ left: 262, top: 52 }}>Calendar connected?</div>
          <div className="lp-st-shape" style={{ left: 470, top: 60, width: 170 }}>Home, first day</div>
          <div className="lp-st-shape" style={{ left: 262, top: 214, width: 132 }}>Connect calendar</div>
          <div className={cn('lp-st-shape', w.held && 'is-held')} style={{ left: 706, top: 60, width: 130 }}>First call</div>
          <div className={cn('lp-st-sticky', !w.sticky && 'is-off')} style={{ left: 520, top: 226, '--rot': '-3deg', background: '#FFE3CF' }}>
            Skip the tour for people who were invited to a call?<small>Maya</small>
          </div>
          <div className="lp-st-sticky" style={{ left: 96, top: 300, '--rot': '2deg', background: '#E2E7FF' }}>
            The calendar row shows its check as it arrives.<small>Kofi</small>
          </div>
          <div className="lp-st-tools">{BOARD_TOOLS.map((t, i) => <span key={t} className={cn(i === 0 && 'is-on')}><Icon name={t} size={17} /></span>)}</div>
          <SharePointer person={CAST.kofi} name="Kofi" className="lp-st-pc" style={{ transform: `translate(${w.kofi.x}px, ${w.kofi.y}px)` }} />
          <SharePointer person={CAST.maya} name="Maya" className="lp-st-pc" style={{ transform: `translate(${w.maya.x}px, ${w.maya.y}px)` }} />
          <SharePointer person={CAST.aiko} name="Aiko" className="lp-st-pc" style={{ transform: `translate(${w.aiko.x}px, ${w.aiko.y}px)` }} />
        </div>
      </div>
    </div>
  );
}

/** Breakout rooms: each room an alcove, everyone in it on its horizon, the rooms on one timer. */
function Alcoves({ s }: { s: Stage }) {
  return ROOMS.map((r, i) => (
    <div key={r.name} className={cn('lp-st-alcove', s.rooms.open && 'is-on', s.rooms.told > i && 'is-told')} style={{ left: alcoveX(i) }}>
      <div className="lp-st-alcove-name">{r.name}</div>
      <div className="lp-st-alcove-who">{r.who.map(nameOf).join(' and ')}</div>
      <div className="lp-st-alcove-msg"><Icon name="megaphone" size={15} /><span>Art: Two minutes, then everyone’s back in the main room.</span></div>
      <div className="lp-st-alcove-time"><i /><b>{clock(s.rooms.left)} left</b></div>
    </div>
  ));
}

function Item({ on, title, by, at }: { on: boolean; title: string; by: string; at: number }) {
  return <div className={cn('lp-st-item lp-st-rv', on && 'is-in')}><div>{title}<small>{by}</small></div><TimeChip seconds={at} /></div>;
}

function Panel({ on, icon, title, children, foot }: { on: boolean; icon: IconName; title: string; children: ReactNode; foot: ReactNode }) {
  return (
    <div className={cn('lp-st-panel', on && 'is-on')}>
      <div className="lp-st-panel-head"><Icon name={icon} size={18} />{title}<Icon name="x" size={16} className="lp-st-x" /></div>
      {children}
      <div className="lp-st-panel-foot">{foot}</div>
    </div>
  );
}

function NotesPanel({ s }: { s: Stage }) {
  return (
    <Panel on={s.panel === 'notes'} icon="notes" title="Notes" foot={<SealedBadge inline title="Written in confidential compute" />}>
      <div className="lp-st-panel-body">
        <div>
          <div className="lp-st-k is-decided"><Icon name="decision" size={14} />Decided</div>
          <Item on={s.noted >= 1} title="The launch moves to Wed 18 Nov" by="Proposed by Priya" at={372} />
        </div>
        <div>
          <div className="lp-st-k is-follow"><Icon name="todos" size={14} />Follow-ups</div>
          <Item on={s.noted >= 2} title="Final onboarding screens" by="Kofi · Mon" at={520} />
          <Item on={s.noted >= 3} title="Help article for support" by="Aiko · Fri" at={555} />
        </div>
        <div>
          <div className="lp-st-k">So far</div>
          <p className="lp-st-sum"><Written text={SUMMARY} shown={s.summed} /></p>
        </div>
      </div>
    </Panel>
  );
}

function ChatPanel({ s }: { s: Stage }) {
  const c = s.chat;
  return (
    <Panel on={s.panel === 'chat'} icon="chat" title="Chat" foot={(
      <div className="lp-st-compose" data-at="compose">
        {c.typed && <span className="lp-st-typed">{c.typed}</span>}
        <span className="lp-st-caret" />
        {!c.typing && <span className="lp-st-ph">{c.dm ? 'Message Priya' : 'Message everyone'}</span>}
        <span className="lp-st-send"><Icon name="send" size={15} /></span>
      </div>
    )}>
      <div className="lp-st-tabs">
        <span className={cn('lp-st-tab', !c.dm && 'is-on')}>Everyone</span>
        <span className={cn('lp-st-tab', c.dm && 'is-on', s.hi.includes('tab:dm') && 'is-hi')} data-at="tab:dm"><Icon name="lock" size={13} />Priya</span>
      </div>
      {c.dm ? (
        <div className="lp-st-panel-body">
          <div className="lp-st-lock"><Icon name="lock" size={14} />Only you and Priya can read this.</div>
          <Msg who="priya" at="14:31">Can you take the pricing question after this?</Msg>
          <Msg who="art" at="14:31" className={cn('lp-st-rv', c.sent && 'is-in')}>Yes, I’ll stay on.</Msg>
        </div>
      ) : (
        <div className="lp-st-panel-body">
          <Msg who="maya" at="14:28" className={cn('lp-st-rv', c.seen >= 1 && 'is-in')} more={(
            <>
              <span className="lp-st-thread"><Icon name="cornerRight" size={13} />2 replies</span>
              <div className={cn('lp-st-replies lp-st-rv', c.seen >= 2 && 'is-in')}>
                <Msg who="kofi" at="14:29">Sign-ups by week, from the dashboard.</Msg>
                <Msg who="priya" at="14:29">Up 18% since the pricing change.</Msg>
              </div>
            </>
          )}>Can someone drop last month’s sign-ups here?</Msg>
          <Msg who="diego" at="14:30" className={cn('lp-st-rv', c.seen >= 3 && 'is-in')}>Sales can announce it the week of the 18th.</Msg>
        </div>
      )}
    </Panel>
  );
}

function RoomsPanel({ s }: { s: Stage }) {
  return (
    <Panel on={s.panel === 'rooms'} icon="rooms" title="Breakout rooms"
      foot={<Button variant="primary" size="sm" className={cn('lp-st-open', s.hi.includes('open-rooms') && 'is-hi')} data-at="open-rooms">Open rooms</Button>}>
      <div className="lp-st-panel-body">
        <div className="lp-st-row"><span>Rooms</span><span className="lp-st-seg"><span>2</span><span className="is-on">3</span><span>4</span></span></div>
        <div className="lp-st-row"><span>How long</span><span className="lp-st-seg"><span>5 min</span><span className="is-on">10 min</span><span>15 min</span></span></div>
        {ROOMS.map((r) => (
          <div key={r.name} className="lp-st-room">
            <div className="lp-st-room-top">{r.name}<small>2 people</small></div>
            <Faces people={r.who.map((id) => CAST[id])} size={24} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Menu({ s, id, from, children }: { s: Stage; id: PopId; from: string; children: ReactNode }) {
  const at = s.at[id];
  return <div className={cn('lp-st-pop', s.pops.includes(id) && 'is-on')} data-pop={id} style={{ left: at?.x ?? 0, top: at?.y ?? 0, '--from': from }}>{children}</div>;
}
function Opt({ s, k, icon, end, children }: { s: Stage; k: string; icon?: IconName | undefined; end?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn('lp-st-opt', s.hi.includes(k) && 'is-hi', s.picked.includes(k) && 'is-picked')} data-at={k}>
      {icon && <Icon name={icon} size={16} />}<span>{children}</span>{end && <span className="lp-st-opt-end">{end}</span>}
      <Icon name="check" size={16} className="lp-st-tick" />
    </div>
  );
}
function Chips({ s, items }: { s: Stage; items: readonly (readonly [string, string])[] }) {
  return <div className="lp-st-chips">{items.map(([k, label]) => <span key={k} data-at={k} className={cn(s.picked.includes(k) && 'is-on')}>{label}</span>)}</div>;
}

function Menus({ s }: { s: Stage }) {
  return (
    <>
      <Menu s={s} id="view" from="100% 0">
        <div className="lp-st-pop-label">Layout</div>
        <Opt s={s} k="view:auto" icon="viewAuto">Auto</Opt>
        <Opt s={s} k="view:speaker" icon="viewSpeaker">Speaker</Opt>
        <Opt s={s} k="view:grid" icon="grid">Grid</Opt>
        <div className="lp-st-pop-div" />
        <div className="lp-st-pop-label">People</div>
        <Chips s={s} items={[['view:tiles', 'Tiles'], ['view:arches', 'Arches'], ['view:hidden', 'Hidden']]} />
      </Menu>
      <Menu s={s} id="status" from="100% 100%">
        <div className="lp-st-pop-label">Set a status</div>
        <Opt s={s} k="status:brb" icon="away">Be right back</Opt>
        <Opt s={s} k="status:listen" icon="listening">Listening only</Opt>
        <Opt s={s} k="status:phone" icon="phone">On my phone</Opt>
        <div className="lp-st-pop-div" />
        <div className="lp-st-pop-label">Back in</div>
        <Chips s={s} items={[['status:2', '2 min'], ['status:5', '5 min'], ['status:10', '10 min']]} />
      </Menu>
      <Menu s={s} id="lang" from="50% 100%">
        <div className="lp-st-pop-label">Captions in</div>
        <Opt s={s} k="lang:en" end="Yours">English</Opt>
        <Opt s={s} k="lang:es">Español</Opt>
        <Opt s={s} k="lang:de">Deutsch</Opt>
        <Opt s={s} k="lang:ja">日本語</Opt>
        <Opt s={s} k="lang:pt">Português</Opt>
      </Menu>
      <Menu s={s} id="tile" from="100% 0">
        <Opt s={s} k="tile:pin" icon="pin">Pin for me</Opt>
        <Opt s={s} k="tile:vol" icon="speaker">Volume for you</Opt>
        <Opt s={s} k="tile:nudge" icon="nudge" end={<Icon name="chevron" size={14} />}>Nudge Kofi</Opt>
      </Menu>
      <Menu s={s} id="nudge" from="0 0">
        <div className="lp-st-pop-label">Only Kofi sees it</div>
        <Opt s={s} k="nudge:muted" icon="micOff">You’re muted</Opt>
        <Opt s={s} k="nudge:hear" icon="hear">Can’t hear you</Opt>
        <Opt s={s} k="nudge:slow" icon="pace">Slow down a little</Opt>
        <Opt s={s} k="nudge:up" icon="speaker">A bit louder</Opt>
      </Menu>
    </>
  );
}

function Dock({ s }: { s: Stage }) {
  return (
    <div className="lp-st-dock">
      <CallDock>
        <DockButton icon={s.micOff ? 'micOff' : 'mic'} label={s.micOff ? 'Unmute' : 'Mute'} off={s.micOff} />
        <DockButton icon="video" label="Turn your camera off" />
        <DockSeparator />
        <DockButton icon="screen" label="Share your screen" />
        <DockButton icon="hand" label="Raise your hand" />
        <DockButton icon="captions" label="Captions" on={s.tool === 'captions'} data-at="tool:captions" />
        <DockButton icon="rooms" label="Breakout rooms" on={s.tool === 'rooms'} data-at="tool:rooms" />
        <DockButton icon="fileText" label="Workspace" on={s.tool === 'work'} data-at="tool:work" />
        <DockButton icon="notes" label="Notes" on={s.tool === 'notes'} data-at="tool:notes" />
        <DockButton icon="chat" label="Chat" on={s.tool === 'chat'} badge={s.unread} data-at="tool:chat" />
        <DockButton icon="more" label="More" />
        <DockSeparator />
        <DockLeave />
      </CallDock>
    </div>
  );
}

/** The pointer that shows each click: it comes in from below the first time, glides between clicks, and rings as it presses. */
function Pointer({ cur }: { cur: Stage['cur'] }) {
  return (
    <AnimatePresence>
      {cur.on && (
        <motion.div key={cur.shows} className="lp-st-cur" initial={{ x: cur.x + 55, y: cur.y + 87, opacity: 0 }}
          animate={{ x: cur.x - 5, y: cur.y - 3, opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}
          transition={{ x: GLIDE, y: GLIDE, opacity: { duration: 0.3 } }}>
          <svg viewBox="0 0 26 26" aria-hidden="true"><path d="M5 3.2 20.6 12.4l-6.9 1.6-3.4 6.3z" /></svg>
          {cur.taps > 0 && <i key={cur.taps} className="lp-st-tap" />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function TourStage({ s, still }: { s: Stage; still: boolean }) {
  const line = LINES[s.caption.line];
  return (
    <div className={cn('lp-st ac-stage', still && 'is-still')}>
      <Top s={s} />
      <Share s={s} />
      <Workspace s={s} />
      <Alcoves s={s} />
      <div className={cn('lp-st-horizon', s.horizon && 'is-on')} />
      <Tiles s={s} />
      <Caption className={cn('lp-st-cap', s.caption.on && 'is-on')} who={<><Avatar person={CAST[line.who]} size={20} />{firstOf(line.who)}</>}
        lang={line.from} original={line.or}>
        <Written text={line.en} shown={s.caption.words} />
      </Caption>
      <Chip icon="eye" className={cn('lp-st-chip', s.chip && 'is-on')}>Only your screen changes</Chip>
      <div className={cn('lp-st-rbar', s.rooms.open && 'is-on')}>
        <span>Rooms are open</span>
        <span className="lp-st-rbar-left">{clock(s.rooms.left)} left</span>
        <span className={cn('lp-st-tb', s.hi.includes('msg-all') && 'is-hi')} data-at="msg-all"><Icon name="megaphone" size={16} />Message every room</span>
        <span className="lp-st-tb">Bring everyone back</span>
      </div>
      <NotesPanel s={s} />
      <ChatPanel s={s} />
      <RoomsPanel s={s} />
      <Menus s={s} />
      <div className={cn('lp-st-toast', s.toast.on && 'is-on')}>
        {s.toast.say === 'share'
          ? <><Avatar person={CAST.kofi} size={22} /><span>Kofi started sharing their screen</span></>
          : <><Icon name="nudge" size={16} /><span>Kofi got your nudge: Can’t hear you</span></>}
      </div>
      <Dock s={s} />
      <Pointer cur={s.cur} />
    </div>
  );
}
