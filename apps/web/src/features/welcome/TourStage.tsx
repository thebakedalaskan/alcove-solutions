/*
 * The call the tour plays on, drawn at 1120 × 700 and always night: the people in it, the top bar and the dock as the call
 * has them, the panels and menus each scene opens, Kofi's screen in its frame, the rooms, the workspace, and the pointer that
 * shows each click. It draws whatever `Stage` says; tourSteps.ts says what changes when. Anything the pointer goes to is
 * marked `data-at`, and each menu `data-pop`. The menus say what the call's own say: a person's ⋯ (TileMenu.tsx), their
 * statuses and nudges (status.ts, nudges.ts), More, and the captions' languages.
 *
 * While a step types or writes, the stage changes every 50 to 100 ms. So each part of the call is drawn from only the bit
 * of `Stage` it shows, and drawn again only when that bit changes: a letter typed redraws the line it's typed into, and
 * someone starting to speak redraws their tile, not the whole call.
 */
import { CAPTION_LANGUAGES } from '@alcove/api';
import {
  Avatar, Button, CallDock, CallTile, CallTimerButton, CallTopButton, CallTopGroup, CallTopRule, Caption, DockButton, DockChevron, DockLeave,
  DockSeparator, DockSplit, DockWords, EASE, Faces, Icon, NotesSign, PointerTag, SharePointer, cn, type IconName
} from '@alcove/ui';
import { AnimatePresence, motion } from 'motion/react';
import { Fragment, memo, type ReactNode } from 'react';
import { NUDGES, NUDGE_KINDS } from '~/features/call/layout/nudges';
import { STATUS, STATUS_KINDS, STATUS_MINUTES } from '~/features/call/layout/status';
import { CAST, firstOf } from '~/features/notes/cast';
import {
  DOC_LINE, GROUND, HORIZON_SAYS, LAYOUTS, LINES, LINKS, ORDER, REPLY, ROOMS, SCREEN, alcoveX, clock, type Box, type Point, type PopId, type Stage,
  type Who
} from './tourSteps';

const nameOf = (id: Who) => (id === 'art' ? 'You' : firstOf(id));
/** How big someone's arch is in their tile: a face in the middle of a tile, or the whole of an arch. */
const faceSize = (b: Box) => Math.round((b.arch ? b.w : Math.min(b.w * 0.36, (b.h * 0.6) / 1.08, 190)) * 10) / 10;
const SAID: Partial<Record<Who, { icon: IconName; text: string }>> = {
  maya: { icon: STATUS.listening.icon, text: STATUS.listening.label },
  art: { icon: STATUS.away.icon, text: `${STATUS.away.label} · 14:37` }
};
const BOARD_TOOLS: readonly IconName[] = ['pointer', 'stickyNote', 'shapes', 'spline', 'type', 'pen'];
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

/** The call's top bar: what the call is, and what's yours at the top right. It slides away in focus. */
const Top = memo(function Top({ tool, away }: { tool: Stage['tool']; away: boolean }) {
  return (
    <div className={cn('lp-st-top', away && 'is-away')}>
      <span className="lp-st-title">Launch planning</span>
      <span className="lp-st-clock">14:32</span>
      <span className="lp-st-vr" />
      <NotesSign stage>Notes on</NotesSign>
      <span className="lp-st-shield"><Icon name="sealed" size={19} /></span>
      <CallTimerButton time={null} label="Timer for everyone" tone="ready" />
      <div className="lp-st-end">
        <CallTopGroup label="On your screen">
          <CallTopButton icon="presentation" word="Board" label="Board" />
          <CallTopButton icon="folderOpen" word="Workspace" label="Workspace" on={tool === 'work'} />
          <CallTopRule />
          <CallTopButton icon="notesPen" word="Notes" label="Notes" />
          <CallTopButton icon="chat" word="Chat" label="Chat" on={tool === 'chat'} />
          <CallTopRule />
          <span className="ic-yb is-faces"><Faces people={[CAST.priya, CAST.kofi, CAST.aiko, CAST.maya]} size={24} /><span className="n">6</span></span>
        </CallTopGroup>
      </div>
    </div>
  );
});

/** Someone in the call, in their tile or folded into an arch, with what their tile says and, under the pointer, its ⋯ and corner. */
const Tile = memo(function Tile({ id, b, speaking, muted, faint, hover, lift, pull, status, away }: {
  id: Who; b: Box; speaking: boolean; muted: boolean;
  /** Hard to hear: their level and their ring are faint. */
  faint: boolean;
  /** The pointer is over the tile, showing its ⋯ and the corner that resizes it. */
  hover: boolean;
  /** Carried by the pointer, or pulled by its corner. */
  lift: boolean;
  pull: boolean;
  /** Their status shows on their tile. */
  status: boolean;
  /** You've stepped away: only ever your tile. */
  away: boolean;
}) {
  const said = SAID[id];
  return (
    <div className={cn('lp-st-tile', b.arch && 'is-arch', hover && 'is-hover', lift && 'is-lift', pull && 'is-pull', away && 'is-away', faint && 'is-faint',
      b.arch && speaking && 'is-up', !b.arch && b.h < 100 && 'is-short')}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h }} data-at={`tile:${id}`}>
      <CallTile person={CAST[id]} name={nameOf(id)} speaking={speaking} muted={muted}
        chrome={(
          <>
            {said && <span className={cn('lp-st-status', status && 'is-on')}><Icon name={said.icon} size={14} />{said.text}</span>}
            {id === 'art' && <span className="lp-st-left"><i /></span>}
            <span className="lp-st-more" data-at={`more:${id}`}><Icon name="more" size={16} /></span>
            <span className="lp-st-rs" data-at={`rs:${id}`}><Icon name="resize" size={14} /></span>
          </>
        )}>
        <span className="lp-st-face"><Avatar person={CAST[id]} size={faceSize(b)} /></span>
      </CallTile>
    </div>
  );
});

/** Kofi's design file, shared to the call (illustration). It never changes, so it's drawn once. */
const SharedScreen = memo(function SharedScreen() {
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
});

/** Kofi's screen on your stage, in its frame: whose it is and what's so, focus and Close, and the screen under them. */
const Screen = memo(function Screen({ on, focus }: { on: boolean; focus: boolean }) {
  const b = focus ? SCREEN.focus : SCREEN.beside;
  return (
    <div className={cn('lp-st-share', on && 'is-on', focus && 'is-focus')} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
      <div className="lp-st-fbar">
        <Avatar person={CAST.kofi} size={24} />
        <span className="lp-st-fname">Kofi’s screen<Icon name="down" size={14} /></span>
        <span className="lp-st-fmeta">Kofi is presenting</span>
        <span className={cn('lp-st-fib', focus && 'is-on')} data-at="focus"><Icon name={focus ? 'shrink' : 'grow'} size={16} /></span>
        <span className="lp-st-fclose"><Icon name="x" size={15} />Close</span>
      </div>
      <div className="lp-st-fbody"><SharedScreen /></div>
    </div>
  );
});

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
const Workspace = memo(function Workspace({ work: w, docHi, boardHi }: { work: Stage['work']; docHi: boolean; boardHi: boolean }) {
  return (
    <div className={cn('lp-st-ws', w.on && 'is-on')}>
      <WsTop board={w.board} docHi={docHi} boardHi={boardHi} />
      <WsDoc on={!w.board} typed={w.typed} comment={w.comment} />
      <WsBoard on={w.board} drawn={w.drawn} sticky={w.sticky} held={w.held} kofi={w.kofi} maya={w.maya} aiko={w.aiko} />
    </div>
  );
});

/** The workspace's tabs, and who's in it. */
const WsTop = memo(function WsTop({ board, docHi, boardHi }: { board: boolean; docHi: boolean; boardHi: boolean }) {
  return (
    <div className="lp-st-ws-top">
      <span className={cn('lp-st-ws-tab', !board && 'is-on', docHi && 'is-hi')} data-at="ws:doc"><Icon name="fileText" size={15} />Launch plan</span>
      <span className={cn('lp-st-ws-tab', board && 'is-on', boardHi && 'is-hi')} data-at="ws:board"><Icon name="shapes" size={15} />Onboarding flow</span>
      <Faces people={[CAST.priya, CAST.kofi, CAST.maya, CAST.aiko]} size={22} />
      <span className="lp-st-ws-live"><i />4 editing</span>
    </div>
  );
});

/** The launch plan: Aiko's line, typed in as Priya writes it, then Kofi's comment beside it. */
const WsDoc = memo(function WsDoc({ on, typed, comment }: { on: boolean; typed: number; comment: boolean }) {
  return (
    <div className={cn('lp-st-ws-view', on && 'is-on')}>
      <div className="lp-st-doc">
        <div className="lp-st-doc-title">Launch plan</div>
        <div className="lp-st-doc-by">Worked on in Launch planning · today</div>
        <div className="lp-st-doc-h">What ships</div>
        <p>The new onboarding, behind a flag, on <span className="lp-st-mark">Wed 18 November</span>. Support gets the help article first.</p>
        <div className="lp-st-doc-h">Before launch</div>
        <Todo done who="maya">Pricing page copy</Todo>
        <Todo who="kofi">Final onboarding screens</Todo>
        <Todo who="aiko">{DOC_LINE.slice(0, typed)}<span className="lp-st-rcaret"><PointerTag person={CAST.priya} name="Priya" /></span></Todo>
      </div>
      <div className={cn('lp-st-comment', comment && 'is-on')}>
        <Msg who="kofi" at="14:31">Moved from the 12th, so support has the article a week ahead.</Msg>
      </div>
    </div>
  );
});

/** The board: its connectors drawn in one by one, a sticky note, and everyone's pointers on it. */
const WsBoard = memo(function WsBoard({ on, drawn, sticky, held, kofi, maya, aiko }: {
  on: boolean; drawn: number; sticky: boolean; held: boolean; kofi: Point; maya: Point; aiko: Point;
}) {
  return (
    <div className={cn('lp-st-ws-view', on && 'is-on')}>
      <div className="lp-st-board">
        <svg className="lp-st-links" viewBox="0 0 900 504" preserveAspectRatio="none" aria-hidden="true">
          {LINKS.map((d, i) => <path key={d} d={d} pathLength={1} className={cn(drawn > i && 'is-on')} />)}
        </svg>
        <div className="lp-st-shape" style={{ left: 76, top: 60, width: 120 }}>Sign in</div>
        <div className="lp-st-shape is-ask" style={{ left: 262, top: 52 }}>Calendar connected?</div>
        <div className="lp-st-shape" style={{ left: 470, top: 60, width: 170 }}>Home, first day</div>
        <div className="lp-st-shape" style={{ left: 262, top: 214, width: 132 }}>Connect calendar</div>
        <div className={cn('lp-st-shape', held && 'is-held')} style={{ left: 706, top: 60, width: 130 }}>First call</div>
        <div className={cn('lp-st-sticky', !sticky && 'is-off')} style={{ left: 520, top: 226, '--rot': '-3deg', background: '#FFE3CF' }}>
          Skip the tour for people who were invited to a call?<small>Maya</small>
        </div>
        <div className="lp-st-sticky" style={{ left: 96, top: 300, '--rot': '2deg', background: '#E2E7FF' }}>
          The calendar row shows its check as it arrives.<small>Kofi</small>
        </div>
        <div className="lp-st-tools">{BOARD_TOOLS.map((t, i) => <span key={t} className={cn(i === 0 && 'is-on')}><Icon name={t} size={17} /></span>)}</div>
        <SharePointer person={CAST.kofi} name="Kofi" className="lp-st-pc" style={{ transform: `translate(${kofi.x}px, ${kofi.y}px)` }} />
        <SharePointer person={CAST.maya} name="Maya" className="lp-st-pc" style={{ transform: `translate(${maya.x}px, ${maya.y}px)` }} />
        <SharePointer person={CAST.aiko} name="Aiko" className="lp-st-pc" style={{ transform: `translate(${aiko.x}px, ${aiko.y}px)` }} />
      </div>
    </div>
  );
});

/** Breakout rooms: each room an alcove, everyone in it on its horizon, the rooms on one timer. */
const Alcoves = memo(function Alcoves({ rooms }: { rooms: Stage['rooms'] }) {
  return ROOMS.map((r, i) => (
    <div key={r.name} className={cn('lp-st-alcove', rooms.open && 'is-on', rooms.told > i && 'is-told')} style={{ left: alcoveX(i) }}>
      <div className="lp-st-alcove-name">{r.name}</div>
      <div className="lp-st-alcove-who">{r.who.map(nameOf).join(' and ')}</div>
      <div className="lp-st-alcove-msg"><Icon name="megaphone" size={15} /><span>You: Two minutes, then everyone’s back in the main room.</span></div>
      <div className="lp-st-alcove-time"><i /><b>{clock(rooms.left)} left</b></div>
    </div>
  ));
});

/** Over the rooms while they're open: the time left, a message to every room, and bringing everyone back. */
const RoomsBar = memo(function RoomsBar({ open, left, msgHi, backHi }: { open: boolean; left: number; msgHi: boolean; backHi: boolean }) {
  return (
    <div className={cn('lp-st-rbar', open && 'is-on')}>
      <span>Rooms are open</span>
      <span className="lp-st-rbar-left">{clock(left)} left</span>
      <span className={cn('lp-st-tb', msgHi && 'is-hi')} data-at="msg-all"><Icon name="megaphone" size={16} />Message every room</span>
      <span className={cn('lp-st-tb', backHi && 'is-hi')} data-at="rooms:back">Bring everyone back</span>
    </div>
  );
});

/**
 * Captions, once they're on: what's said in your language a word at a time, with what was said underneath, or while nobody
 * speaks, that it appears here. The button on them picks the language.
 */
const Captions = memo(function Captions({ caption, langHi }: { caption: Stage['caption']; langHi: boolean }) {
  const line = caption.line === null ? null : LINES[caption.line];
  const language = <span className={cn('lp-st-capbtn', langHi && 'is-hi')} data-at="cap:lang"><Icon name="translate" size={14} />{caption.en ? 'English' : 'As spoken'}</span>;
  return line ? (
    <Caption className={cn('lp-st-cap', caption.cc && 'is-on')}
      who={<><Avatar person={CAST[line.who]} size={20} />{firstOf(line.who)}<span className="lang">{line.from}</span>{language}</>} original={line.or}>
      <Written text={line.en} shown={caption.words} />
    </Caption>
  ) : (
    <Caption className={cn('lp-st-cap', caption.cc && 'is-on')} who={<><Icon name="captions" size={15} />Captions{language}</>}>
      <span className="lp-st-cap-wait">What’s said appears here as people talk.</span>
    </Caption>
  );
});

function Panel({ on, icon, title, children, foot }: { on: boolean; icon: IconName; title: string; children: ReactNode; foot: ReactNode }) {
  return (
    <div className={cn('lp-st-panel', on && 'is-on')}>
      <div className="lp-st-panel-head"><Icon name={icon} size={18} />{title}<Icon name="x" size={16} className="lp-st-x" /></div>
      {children}
      <div className="lp-st-panel-foot">{foot}</div>
    </div>
  );
}

const ChatPanel = memo(function ChatPanel({ on, chat: c }: { on: boolean; chat: Stage['chat'] }) {
  return (
    <Panel on={on} icon="chat" title="Chat" foot={(
      <div className="lp-st-compose" data-at="compose">
        {c.typed && <span className="lp-st-typed">{c.typed}</span>}
        <span className="lp-st-caret" />
        {!c.typing && <span className="lp-st-ph">{c.dm ? 'Message Priya' : 'Message everyone'}</span>}
        <span className="lp-st-send"><Icon name="send" size={15} /></span>
      </div>
    )}>
      <div className="lp-st-tabs">
        <span className={cn('lp-st-tab', !c.dm && 'is-on')} data-at="tab:all">Everyone</span>
        <span className={cn('lp-st-tab', c.dm && 'is-on', c.dot && 'has-dot')} data-at="tab:dm"><Icon name="lock" size={13} />Priya<span className="lp-st-dot" /></span>
      </div>
      {c.dm ? (
        <div className="lp-st-panel-body">
          <div className="lp-st-lock"><Icon name="lock" size={14} />Only you and Priya can read this.</div>
          <Msg who="priya" at="14:31">Can you take the pricing question after this?</Msg>
          <Msg who="art" at="14:31" className={cn('lp-st-rv', c.sent && 'is-in')}>{REPLY}</Msg>
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
});

const RoomsPanel = memo(function RoomsPanel({ on, hi }: { on: boolean; hi: boolean }) {
  return (
    <Panel on={on} icon="rooms" title="Breakout rooms"
      foot={<Button variant="primary" size="sm" className={cn('lp-st-open', hi && 'is-hi')} data-at="open-rooms">Open rooms</Button>}>
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
});

/** What's under the pointer in the menus, and what's chosen in them. */
interface Picks { hi: Stage['hi']; picked: Stage['picked'] }

function Menu({ id, open, at, from, className, children }: { id: PopId; open: boolean; at: Point | undefined; from: string; className?: string | undefined; children: ReactNode }) {
  return <div className={cn('lp-st-pop', open && 'is-on', className)} data-pop={id} style={{ left: at?.x ?? 0, top: at?.y ?? 0, '--from': from }}>{children}</div>;
}
function Opt({ p, k, icon, end, quiet = false, children }: { p: Picks; k: string; icon?: IconName | undefined; end?: ReactNode; quiet?: boolean; children: ReactNode }) {
  return (
    <div className={cn('lp-st-opt', quiet && 'is-quiet', p.hi.includes(k) && 'is-hi', p.picked.includes(k) && 'is-picked')} data-at={k}>
      {icon && <Icon name={icon} size={16} />}<span>{children}</span>{end && <span className="lp-st-opt-end">{end}</span>}
      <Icon name="check" size={16} className="lp-st-tick" />
    </div>
  );
}
/** Equal choices in a row: what's picked, or else what's `chosen` already, is lit. */
function Chips({ p, items, chosen }: { p: Picks; items: readonly (readonly [string, string])[]; chosen?: string }) {
  return <div className="lp-st-chips">{items.map(([k, label]) => <span key={k} data-at={k} className={cn((p.picked.includes(k) || chosen === k) && 'is-on')}>{label}</span>)}</div>;
}

/**
 * The menus the steps open, as the call has them: which are open and where, what's under the pointer in them, and what's
 * chosen. You host the call, so a person's ⋯ ends with what the host can do.
 */
const Menus = memo(function Menus({ pops, at, step, custom, hi, picked }: {
  pops: Stage['pops']; at: Stage['at']; step: Stage['step']; custom: boolean; hi: Stage['hi']; picked: Stage['picked'];
}) {
  const p: Picks = { hi, picked };
  const menu = (id: PopId) => ({ id, open: pops.includes(id), at: at[id] });
  return (
    <>
      <Menu {...menu('more')} from="50% 100%">
        <Opt p={p} k="more:captions" icon="captions">Turn on captions</Opt>
        <Opt p={p} k="more:mark" icon="bookmark">Mark this moment</Opt>
        <Opt p={p} k="more:catch-up" icon="history">Catch up on what you missed</Opt>
        <Opt p={p} k="more:rooms" icon="door">Breakout rooms</Opt>
        <div className="lp-st-pop-div" />
        <Opt p={p} k="more:float" icon="pip">Open floating call</Opt>
        {custom && <Opt p={p} k="more:reset" icon="reset" quiet>Reset layout</Opt>}
        <Opt p={p} k="more:move" icon="phone">Move to another device</Opt>
        <Opt p={p} k="more:settings" icon="settings">Settings</Opt>
      </Menu>
      <Menu {...menu('lang')} from="100% 100%" className="is-lang">
        <div className="lp-st-pop-label">Captions in</div>
        <Opt p={p} k="lang:spoken">As spoken</Opt>
        {CAPTION_LANGUAGES.map((l) => (
          <Opt key={l.code} p={p} k={`lang:${l.code}`}>{l.name}{l.name !== l.english && <span className="lp-st-sub"> · {l.english}</span>}</Opt>
        ))}
        <p className="lp-st-pop-hint">Translated in confidential compute. Everyone picks their own language. The call is still transcribed for notes when captions are off.</p>
      </Menu>
      <Menu {...menu('self')} from="100% 0">
        <div className="lp-st-pop-label">Set a status</div>
        {STATUS_KINDS.map((k) => <Opt key={k} p={p} k={`self:${k}`} icon={STATUS[k].icon}>{STATUS[k].label}</Opt>)}
        <div className="lp-st-pop-label">Back in</div>
        <Chips p={p} items={STATUS_MINUTES.map((m) => [`self:${m}`, `${m} min`] as const)} />
        <div className="lp-st-pop-div" />
        <Opt p={p} k="self:pin" icon="pin">Pin for me</Opt>
        <div className="lp-st-pop-label">See yourself</div>
        <Chips p={p} items={[['self:grid', 'Grid'], ['self:corner', 'Corner'], ['self:hidden', 'Hidden']]} chosen="self:grid" />
        <div className="lp-st-pop-div" />
        <Opt p={p} k="self:spotlight" icon="spotlight">Spotlight for everyone</Opt>
      </Menu>
      <Menu {...menu('tile')} from="100% 0">
        {step === 'nudge' ? (
          <>
            <div className="lp-st-pop-step"><Icon name="chevronLeft" size={16} />Only Kofi sees it</div>
            {NUDGE_KINDS.map((k) => <Opt key={k} p={p} k={`nudge:${k}`} icon={NUDGES[k].icon}>{NUDGES[k].label}</Opt>)}
          </>
        ) : (
          <>
            <Opt p={p} k="tile:pin" icon="pin">Pin for me</Opt>
            <Opt p={p} k="tile:message" icon="lock">Message Kofi privately</Opt>
            <Opt p={p} k="tile:nudge" icon="nudge" end={<Icon name="chevron" size={15} />}>Nudge Kofi</Opt>
            <div className="lp-st-pop-label">Volume for you</div>
            <div className="lp-st-vol"><Icon name="speaker" size={17} /><span className="lp-st-vol-bar"><i /></span><span className="lp-st-vol-n">100%</span></div>
            <div className="lp-st-pop-div" />
            <Opt p={p} k="tile:spotlight" icon="spotlight">Spotlight for everyone</Opt>
            <Opt p={p} k="tile:mute" icon="micOff">Mute for everyone</Opt>
            <Opt p={p} k="tile:remove" icon="leave">Remove from the call</Opt>
          </>
        )}
      </Menu>
    </>
  );
});

/** What a toast over the call says, as the call says it. */
const TOASTS: Record<Stage['toast']['say'], ReactNode> = {
  view: <><Icon name="eye" size={16} /><span>Only your view changes. Reset layout, in More, puts it back.</span></>,
  share: <><Icon name="screen" size={16} /><span>Kofi is presenting their screen.</span></>,
  unshare: <><Icon name="stopShare" size={16} /><span>Kofi stopped sharing.</span></>,
  nudge: <><Icon name="nudge" size={16} /><span>Kofi got your nudge: {NUDGES['cant-hear'].label}</span></>
};
const Toast = memo(function Toast({ toast }: { toast: Stage['toast'] }) {
  return <div className={cn('lp-st-toast', toast.on && 'is-on')}>{TOASTS[toast.say]}</div>;
});

/** Talking with your microphone muted, said at the top of the call, with Unmute. */
const MutePill = memo(function MutePill({ on }: { on: boolean }) {
  return (
    <div className={cn('lp-st-pill', on && 'is-on')}>
      <Icon name="micOff" size={15} /><span>You’re talking on mute</span><span className="lp-st-unmute" data-at="unmute">Unmute</span>
    </div>
  );
});

/** In focus, the people stand on the horizon, and whoever's talking is said beside them. */
const HorizonSays = memo(function HorizonSays({ on, who }: { on: boolean; who: Who | null }) {
  return <span className={cn('lp-st-hz', on && who && 'is-on')} style={{ left: HORIZON_SAYS, top: GROUND - 24 }}>{who && `${firstOf(who)} is talking`}</span>;
});

/** In focus the top bar slides away, and the host's timer keeps a strip of its own over the frame. */
const FocusTimer = memo(function FocusTimer({ on }: { on: boolean }) {
  return <CallTimerButton time={null} label="Timer for everyone" tone="ready" className={cn('lp-st-ftimer', on && 'is-on')} />;
});

/** The dock, as the call has it: in focus it keeps the microphone, the camera, Show everything and Leave. */
const Dock = memo(function Dock({ micOff, focus, more }: { micOff: boolean; focus: boolean; more: boolean }) {
  return (
    <div className="lp-st-dock">
      <CallDock tucked={focus}>
        <DockSplit className="keep">
          <DockButton icon={micOff ? 'micOff' : 'mic'} label={micOff ? 'Unmute' : 'Mute'} off={micOff} data-at="mic" />
          <DockChevron label="Microphone and speaker" />
        </DockSplit>
        <DockSplit className="keep">
          <DockButton icon="video" label="Turn camera off" />
          <DockChevron label="Camera and background" />
        </DockSplit>
        <DockSeparator />
        <DockButton icon="screen" label="Share" word="Share" />
        <DockButton icon="hand" label="Raise your hand" />
        <DockButton icon="more" label="More" on={more} data-at="more" />
        <DockSeparator />
        {focus && <DockWords icon="shrink" className="keep">Show everything</DockWords>}
        <DockLeave className="keep" />
      </CallDock>
    </div>
  );
});

/** The pointer that shows each click: it comes in from below the first time, glides between clicks, and rings as it presses. */
const Pointer = memo(function Pointer({ cur }: { cur: Stage['cur'] }) {
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
});

/** Where someone is: where the layout puts them, or where the pointer holds them, or as big as their corner is pulled. */
function placeOf(s: Stage, id: Who): Box {
  const b = LAYOUTS[s.layout][id];
  if (s.lift === id && s.held) return { ...b, x: s.held.x, y: s.held.y };
  if (s.pull?.who === id) return { ...b, w: s.pull.w, h: s.pull.h };
  return b;
}

export const TourStage = memo(function TourStage({ s, still }: { s: Stage; still: boolean }) {
  return (
    <div className={cn('lp-st ac-stage', still && 'is-still')}>
      <Top tool={s.tool} away={s.focus} />
      <FocusTimer on={s.focus} />
      <Screen on={s.screen} focus={s.focus} />
      <Workspace work={s.work} docHi={s.hi.includes('ws:doc')} boardHi={s.hi.includes('ws:board')} />
      <Alcoves rooms={s.rooms} />
      {ORDER.map((id) => (
        <Tile key={id} id={id} b={placeOf(s, id)} speaking={s.speaking === id} muted={s.muted.includes(id)} faint={s.faint === id}
          hover={s.hover === id} lift={s.lift === id} pull={s.pull?.who === id} status={s.status.includes(id)} away={id === 'art' && s.away} />
      ))}
      <HorizonSays on={s.focus} who={s.speaking} />
      <MutePill on={s.onMute} />
      <Captions caption={s.caption} langHi={s.hi.includes('cap:lang')} />
      <RoomsBar open={s.rooms.open} left={s.rooms.left} msgHi={s.hi.includes('msg-all')} backHi={s.hi.includes('rooms:back')} />
      <ChatPanel on={s.panel === 'chat'} chat={s.chat} />
      <RoomsPanel on={s.panel === 'rooms'} hi={s.hi.includes('open-rooms')} />
      <Menus pops={s.pops} at={s.at} step={s.step} custom={s.custom} hi={s.hi} picked={s.picked} />
      <Toast toast={s.toast} />
      <Dock micOff={s.micOff} focus={s.focus} more={s.pops.includes('more')} />
      <Pointer cur={s.cur} />
    </div>
  );
});
