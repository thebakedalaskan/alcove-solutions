/*
 * CallFrame: the frame anything open on your stage wears, always at night. Its bar says whose it is (their arch, or the
 * kind's icon while it's only on your screen), what it is (a menu, from its name), how it stands and, on a board or the
 * workspace everyone in the call can edit, who can (a button that opens who's in it, in the name's menu), then what's yours to
 * press: following its presenter, Present, focus, Stop sharing and Close. While you present, Close asks whether it's for you
 * or for everyone; while some people here can't open the board, Present asks first. A board you present has its pager at
 * its foot. The body here is a plain drawing of what the frame holds in the call.
 */
import { CallFrame, CloseAsk, FramePager, Icon, ICON_NAMES, Kbd, PresentAsk, type IconName } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { screenImage } from '../../../src/api/media';
import { Box, did, onStage } from '../../../src/component';
import { PRIYAS_SCREEN } from '../../../src/world/boards';
import { LAUNCH_CHECKLIST } from '../../../src/world/notes';
import { ART, PRIYA } from '../../../src/world/people';

/* ---------- What the frame holds, drawn plainly ---------- */

const RETRO = [
  { title: 'Went well', tone: 'var(--note-butter)', notes: ['Beta sign-ups beat the plan', 'Support ran launch day with no queue', 'Pricing page shipped a week early'] },
  { title: 'Could improve', tone: 'var(--note-rose)', notes: ['Nobody owned the status page', 'Changelog went out after the launch post'] },
  { title: 'Actions', tone: 'var(--note-sky)', notes: ['Kofi owns the status page from now on', 'Changelog goes out before the post'] }
];

/** The launch retro on its night sheet; `at` dims every frame but the one its presenter is on. */
function BoardBody({ at }: { at?: number | undefined }) {
  const sheet: CSSProperties = {
    position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 28, padding: '76px 44px 80px',
    background: 'radial-gradient(var(--bd-dot) 1.1px, transparent 1.4px) 0 0 / 24px 24px, var(--bd-ground)'
  };
  return (
    <div style={sheet}>
      {RETRO.map((f, i) => (
        <div key={f.title} style={{ position: 'relative', borderRadius: 20, background: 'var(--bf-fill)', boxShadow: 'inset 0 0 0 1px var(--bf-ring)', opacity: at === undefined || at === i ? 1 : 0.3 }}>
          <h4 style={{ position: 'absolute', left: 4, top: -40, margin: 0, font: '450 22px/1.1 var(--font-display)', color: 'var(--ink)', whiteSpace: 'nowrap' }}>{f.title}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 12, padding: 14 }}>
            {f.notes.map((n) => (
              <div key={n} style={{ aspectRatio: '1 / .92', padding: '11px 12px', borderRadius: 12, background: f.tone, boxShadow: 'var(--note-shadow)', color: 'var(--note-ink)', font: '500 13px/1.32 var(--font-sans)' }}>{n}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const PLAN: { h: string; p?: string; li?: string[] }[] = [
  { h: 'The date', p: 'The launch moves to Wednesday 18 November. Sign-ups are back up since the pricing change, so the date holds.' },
  { h: 'What goes out', li: ['Paying for minutes of notes, with free minutes every month', 'A monthly option on the team plan', 'The new onboarding, as the design review leaves it'] },
  { h: 'Who does what', li: ['Kofi: the status page and the changelog', 'Aiko: the empty states, by Thursday', 'Priya: the pricing page copy'] },
  { h: 'Risks', p: 'Nobody has tried the importer with a large team yet. Maya runs it on Vandelay’s own account on Monday.' }
];
const PAGES: [IconName, string][] = [['notes', 'Notes'], ['todos', 'Follow-ups'], ['transcript', 'Transcript']];
const DOCS: [IconName, string][] = [['fileText', 'Launch plan'], ['fileText', 'Launch checklist'], ['fileText', 'Pricing page copy'], ['film', 'Onboarding walkthrough']];

/** The call's workspace on the launch plan: its pages and documents, then the page. A phone has only the page. */
function WorkspaceBody({ phone: asked = false }: { phone?: boolean | undefined }) {
  const phone = asked || onAPhone();
  const row = (on: boolean): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 9, height: 32, padding: '0 8px', borderRadius: 9, background: on ? 'rgb(255 255 255 / .08)' : 'none', color: on ? 'var(--ink)' : 'var(--ink-2)', font: '500 13px/1 var(--font-sans)' });
  const label: CSSProperties = { padding: '14px 8px 6px', color: 'var(--ink-3)', font: '500 12px/1 var(--font-sans)' };
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--surface)', color: 'var(--ink)' }}>
      {!phone && (
        <nav style={{ flex: 'none', width: 224, padding: '14px 10px', background: 'var(--ground)', boxShadow: 'inset -1px 0 0 var(--line)' }}>
          <div style={{ padding: '2px 8px 4px', font: '600 13.5px/1.2 var(--font-sans)' }}>Launch review · 4 Nov</div>
          <div style={label}>This call</div>
          {PAGES.map(([icon, t]) => <div key={t} style={row(false)}><Icon name={icon} size={15} />{t}</div>)}
          <div style={label}>Documents</div>
          {DOCS.map(([icon, t]) => <div key={t} style={row(t === 'Launch plan')}><Icon name={icon} size={15} />{t}</div>)}
        </nav>
      )}
      <article style={{ flex: 1, minWidth: 0, maxWidth: 760, padding: phone ? '22px 20px' : '30px 44px', overflow: 'hidden' }}>
        <h1 style={{ margin: '0 0 12px', font: '450 34px/1.12 var(--font-display)' }}>Launch plan</h1>
        {PLAN.map((s) => (
          <section key={s.h} style={{ margin: '0 0 18px' }}>
            <h2 style={{ margin: '0 0 6px', font: '600 17px/1.3 var(--font-sans)' }}>{s.h}</h2>
            {s.p && <p style={{ margin: 0, color: 'var(--ink-2)', font: '400 14.5px/1.6 var(--font-sans)' }}>{s.p}</p>}
            {s.li && <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--ink-2)', font: '400 14.5px/1.6 var(--font-sans)' }}>{s.li.map((l) => <li key={l}>{l}</li>)}</ul>}
          </section>
        ))}
      </article>
    </div>
  );
}

/** A shared screen: the picture, at its own shape, on the stage. */
function ScreenBody({ src }: { src: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '28px 40px', background: 'var(--stage)' }}>
      <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10, boxShadow: '0 20px 50px -20px rgb(0 0 0 / .9)' }} />
    </div>
  );
}

/* ---------- The name's menu, as the app fills it ---------- */

function Row({ icon, label, k }: { icon: IconName; label: string; k?: string | undefined }) {
  return <button type="button" className="mi" onClick={did(label)}><Icon name={icon} size={18} /><span className="t">{label}</span>{k && <Kbd>{k}</Kbd>}</button>;
}
const BOARD_MENU = (
  <>
    <Row icon="pen" label="Rename" /><Row icon="folder" label="Open where it’s saved" /><Row icon="people" label="Who can add to it" />
    <Row icon="link" label="Copy link" /><Row icon="download" label="Download as an image" /><Row icon="fileText" label="Download as a PDF" /><Row icon="moon" label="Night board" />
  </>
);
const WORKSPACE_MENU = (
  <>
    <Row icon="folders" label="Switch workspace" /><Row icon="search" label="Find in the workspace" k="⌘K" /><Row icon="addUser" label="Share workspace" />
    <Row icon="pen" label="Rename" /><Row icon="link" label="Copy link" />
  </>
);
/** The same menu for a guest: what a guest can use. They aren't in the workspace, so it's who's in the call, not Share. */
const GUEST_WORKSPACE_MENU = <><Row icon="search" label="Find in the workspace" k="⌘K" /><Row icon="people" label="Who’s in it" /></>;
/** Who can edit it, after how it stands: everyone in the call, on the call's board or workspace. */
const EVERYONE = { label: 'Everyone in the call can edit', onPress: did('Who’s in it') };
const YOUR_SCREEN_MENU = <><Row icon="pointer" label="Others can point at it" /><Row icon="eraser" label="Clear marks" /><Row icon="screen" label="Change what you share" /></>;
const THEIR_SCREEN_MENU = (
  <>
    <Row icon="pointer" label="Point at it" k="L" /><Row icon="pause" label="Freeze the picture" k="F" /><Row icon="stepBack" label="Earlier picture" k="," />
    <Row icon="zoomIn" label="Zoom" /><Row icon="speakerOff" label="Mute its sound for you" /><Row icon="external" label="Open in its own window" />
    <Row icon="presentation" label="Put on the board" /><Row icon="panelRight" label="Show beside" />
    <div className="ic-msep" />
    <Row icon="x" label="Stop it for everyone" />
  </>
);
const menu = (label: string, children: ReactNode, open = false) => ({ open, onOpenChange: did('menu'), label, children });

/** The board presenter's pager, stepping through the retro's frames. */
function Pager({ notes = false }: { notes?: boolean | undefined }) {
  const [at, setAt] = useState(1);
  const [mine, setMine] = useState(notes);
  const part = RETRO[at - 1]?.title ?? '';
  return (
    <FramePager at={at} total={RETRO.length} part={part} onBack={() => { did('Back a frame')(); setAt(Math.max(1, at - 1)); }}
      onNext={() => { did('Next frame')(); setAt(Math.min(RETRO.length, at + 1)); }} notes={{ on: mine, onToggle: () => { did('Your notes')(); setMine(!mine); } }} />
  );
}

/* ---------- The frame, as the call keeps it ---------- */

type FrameProps = ComponentProps<typeof CallFrame>;

/** Under 600px the call is a phone's, whatever the story says: as the app does there. */
const onAPhone = (): boolean => typeof window !== 'undefined' && window.matchMedia('(max-width: 599px)').matches;

/**
 * The frame in the box the call gives it, answering presses as the call would: its menu and questions open and close,
 * focus and following switch.
 */
function Live(props: FrameProps) {
  const [menuOpen, setMenuOpen] = useState(props.menu?.open ?? false);
  const [closeOpen, setCloseOpen] = useState(props.close?.ask?.open ?? false);
  const [presentOpen, setPresentOpen] = useState(props.present?.ask?.open ?? false);
  const [focusOn, setFocusOn] = useState(props.focus?.on ?? false);
  const [follow, setFollow] = useState(props.following?.on ?? false);
  const { menu: m, close: c, present: p, focus: f, following: fl } = props;
  const phone = !!props.phone || onAPhone();
  const frame: FrameProps = {
    ...props,
    phone,
    menu: m && { ...m, open: menuOpen, onOpenChange: (o) => { m.onOpenChange(o); setMenuOpen(o); } },
    close: c && { ...c, ask: c.ask && { ...c.ask, phone, open: closeOpen, onOpenChange: (o) => { c.ask?.onOpenChange(o); setCloseOpen(o); } } },
    present: p && { ...p, ask: p.ask && { ...p.ask, phone, open: presentOpen, onOpenChange: (o) => { p.ask?.onOpenChange(o); setPresentOpen(o); } } },
    focus: f && !phone ? { on: focusOn, onToggle: () => { f.onToggle(); setFocusOn(!focusOn); } } : null,
    following: fl && { ...fl, on: follow, onToggle: () => { fl.onToggle(); setFollow(!follow); } },
    lit: fl ? follow : props.lit,
    focused: !phone && (props.focused || focusOn)
  };
  const big = !phone && (props.focused || focusOn);
  return (
    <Box width={phone ? '100%' : big ? 'min(1408px, 100%)' : 'min(1148px, 100%)'} height={phone ? 'min(640px, calc(100vh - 80px))' : big ? 'calc(100vh - 80px)' : 'min(720px, calc(100vh - 80px))'}>
      <CallFrame {...frame} />
    </Box>
  );
}

const meta = {
  title: 'Components/In a call/CallFrame',
  component: CallFrame,
  subcomponents: { FramePager, CloseAsk, PresentAsk },
  ...onStage,
  args: {
    who: null, icon: 'presentation', name: 'Launch retro', meta: 'Only on your screen', label: 'Launch retro, only you see it', access: EVERYONE,
    menu: menu('Launch retro', BOARD_MENU), following: null, present: { onPress: did('Present') },
    focus: { on: false, onToggle: did('Focus') }, close: { tip: 'Close it', onClose: did('Close') },
    lit: false, focused: false, phone: false, children: <BoardBody />
  },
  argTypes: {
    icon: { control: 'select', options: ICON_NAMES },
    who: { control: false }, access: { control: false }, menu: { control: false }, following: { control: false }, present: { control: false }, focus: { control: false },
    close: { control: false }, onStop: { control: false }, foot: { control: false }, children: { control: false }, style: { control: false }, className: { control: false }
  },
  render: (args) => <Live {...args} />
} satisfies Meta<typeof CallFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Board, at the top right, opened a board on your screen: the kind's icon, that it's only on your screen and that everyone in the
 * call can edit it, Present (the one filled button), focus and Close.
 */
export const OpenJustForYou: Story = { name: 'Only on your screen' };
/** The workspace, on your screen on its launch plan: everyone in the call can edit it, which opens who's in it. */
export const WorkspaceJustForYou: Story = {
  name: 'The workspace, only on your screen',
  args: { icon: 'folderOpen', name: 'Launch review · 4 Nov', label: 'Launch review · 4 Nov, only you see it', menu: menu('Launch review · 4 Nov', WORKSPACE_MENU), children: <WorkspaceBody /> }
};
/** Its name's menu: the workspace's one menu. For the organizer, Switch workspace, Find, Share workspace, Rename and Copy link. */
export const WorkspaceMenu: Story = {
  name: 'The workspace, its menu open',
  args: { ...WorkspaceJustForYou.args, menu: menu('Launch review · 4 Nov', WORKSPACE_MENU, true) }
};
/** A guest's: they can edit it while they're in the call, and their menu has what a guest can use, Find and Who's in it. */
export const WorkspaceForAGuest: Story = {
  name: 'The workspace, for a guest',
  args: { ...WorkspaceJustForYou.args, access: { label: 'You can edit while you’re in the call', onPress: did('Who’s in it') }, menu: menu('Launch review · 4 Nov', GUEST_WORKSPACE_MENU, true) }
};
/** A guest on the call's board: there's no sheet of who has it for them, so who can edit it is only said. */
export const BoardForAGuest: Story = { name: 'The call’s board, for a guest', args: { access: { label: 'You can edit while you’re in the call' } } };
/** A breakout room's own board: everyone in the room can edit it. */
export const RoomBoard: Story = { name: 'A room’s own board', args: { name: 'Pricing board', label: 'Pricing board, only you see it', access: { label: 'Everyone in this room can edit' } } };
/**
 * You present the board: your arch, how many follow you, and Close asks first. The pager at its foot steps everyone
 * following you through its frames; the notebook opens your own notes.
 */
export const YouPresent: Story = {
  name: 'You present',
  args: {
    who: ART, meta: 'You’re presenting · 3 following', label: 'Launch retro, everyone sees it', present: undefined,
    close: { tip: 'Close it for you, or for everyone', onClose: did('Close'), ask: { open: false, onOpenChange: did('Close’s question'), title: 'Close Launch retro', onMe: did('For you'), onEveryone: did('For everyone') } },
    foot: <Pager />, children: <BoardBody at={0} />
  }
};
/** Priya presents the workspace, and you follow her: her arch, Following Priya with Unfollow, and the edge lit. */
export const Following: Story = {
  args: {
    who: PRIYA, icon: 'folderOpen', name: 'Launch review · 4 Nov', meta: 'Priya is presenting', label: 'Launch review · 4 Nov, Priya is presenting',
    menu: menu('Launch review · 4 Nov', WORKSPACE_MENU), present: undefined, lit: true,
    following: { person: PRIYA, name: 'Priya', on: true, where: 'Priya is in Launch plan', onToggle: did('Follow') },
    close: { tip: 'Close it for you. While Priya presents, its tile takes you back', onClose: did('Close') }, children: <WorkspaceBody />
  }
};
/** You unfollowed to work on your own: Follow Priya says where she is, and the edge is quiet. */
export const Unfollowed: Story = { args: { ...Following.args, lit: false, following: { person: PRIYA, name: 'Priya', on: false, where: 'Priya is in Launch plan', onToggle: did('Follow') } } };
/** Your screen: Stop sharing ends it for everyone, so there's no Close. */
export const YourScreen: Story = {
  name: 'Your screen',
  args: {
    who: ART, icon: 'screen', name: 'Your screen', meta: 'You’re presenting · a tab with sound', label: 'Your screen, everyone sees it', access: null,
    menu: menu('Your screen', YOUR_SCREEN_MENU), present: undefined, close: null, onStop: did('Stop sharing'), children: <ScreenBody src={screenImage(LAUNCH_CHECKLIST)} />
  }
};
/** Priya’s screen, its name's menu open: pointing, freezing, zooming and sound for you, and, for the organizer, Stop it for everyone. */
export const TheirScreenMenu: Story = {
  name: 'Someone’s screen, its menu open',
  args: {
    who: PRIYA, icon: 'screen', name: 'Priya’s screen', meta: 'Priya is presenting', label: 'Priya’s screen, Priya is presenting', access: null,
    menu: menu('Priya’s screen', THEIR_SCREEN_MENU, true), present: undefined,
    close: { tip: 'Close it for you. While Priya presents, its tile takes you back', onClose: did('Close') }, children: <ScreenBody src={screenImage(PRIYAS_SCREEN)} />
  }
};
/** While you present the workspace, Close asks: for you, or for everyone. */
export const ClosesQuestion: Story = {
  name: 'Close’s question',
  args: {
    who: ART, icon: 'folderOpen', name: 'Launch review · 4 Nov', meta: 'You’re presenting · 3 following', label: 'Launch review · 4 Nov, everyone sees it',
    menu: menu('Launch review · 4 Nov', WORKSPACE_MENU), present: undefined, children: <WorkspaceBody />,
    close: { tip: 'Close it for you, or for everyone', onClose: did('Close'), ask: { open: true, onOpenChange: did('Close’s question'), title: 'Close Launch review · 4 Nov', onMe: did('For you'), onEveryone: did('For everyone') } }
  }
};
/** Theo and Sam can't open the onboarding flow: Present asks before anyone sees it. */
export const PresentsQuestion: Story = {
  name: 'Present’s question',
  args: {
    name: 'Onboarding flow', label: 'Onboarding flow, only you see it', menu: menu('Onboarding flow', BOARD_MENU), access: null,
    present: { onPress: did('Present'), ask: { open: true, onOpenChange: did('Present’s question'), names: ['Theo', 'Sam'], board: 'Onboarding flow', where: 'Aiko’s workspace', onLetIn: did('Let them in for this call'), onWithout: did('Present without them') } }
  }
};
/** Focus fills the window with it: a squarer edge, and Leave focus in place of the arrows. */
export const Focus: Story = { args: { ...Following.args, focused: true, focus: { on: true, onToggle: did('Focus') } } };
/** On a phone: how it stands goes under its name, there's no focus, and Present and Close keep their words. */
export const Phone: Story = {
  args: { ...WorkspaceJustForYou.args, focus: null, phone: true, children: <WorkspaceBody phone /> },
  globals: { viewport: { value: 'phone', isRotated: false } }
};
/** Following Priya on a phone: her face and Unfollow, with the words read out. */
export const PhoneFollowing: Story = {
  name: 'Phone, following',
  args: { ...Following.args, focus: null, phone: true, children: <WorkspaceBody phone /> },
  globals: { viewport: { value: 'phone', isRotated: false } }
};
