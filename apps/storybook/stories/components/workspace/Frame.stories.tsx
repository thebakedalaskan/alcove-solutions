/*
 * A workspace, full screen: WsFrame holds its side panel (WsSide: the logo, the switcher with the workspace's WsMark, Search,
 * then the list's own rows and sections, Trash and who can open it, which opens who's in it) beside the page, with one bar
 * over the page (WsBar: the way back and the path, how it's saving, who else is here, Share, ⋯, leaving full screen, and you).
 * Home is WsHomeBand (the name on the evening), WsAbout (its line, which an admin writes in place), WsPeopleLine and
 * WsHomeSections. A page's title has WsDocMeta under it. Everything here answers: rows open, the bar goes back, the line is
 * written and kept.
 */
import {
  Avatar, CallChip, CallRow, FileCard, Logo, WsAbout, WsBar, WsDocMeta, WsFrame, WsHomeBand, WsHomeSection, WsMark, WsPeopleLine, WsRow, WsSection, WsShareSheet, WsSide, WsTrashRow,
  hereLine, type LinkRender, type WsFace, type WsNaming, type WsPhone, type WsPop, type WsShareRow
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { did } from '../../../src/component';
import { ART, INES, KOFI, PRIYA } from '../../../src/world/people';

const PHONE = { parameters: { layout: 'fullscreen' }, globals: { viewport: { value: 'phone', isRotated: false } } };
const pop = (content: ReactNode, [open, setOpen]: [boolean, (open: boolean) => void]): WsPop => ({ open, onOpenChange: setOpen, content });
/** A link that only says it was followed. */
const link = (name: string): LinkRender => (props) => <a {...props} href="#" onClick={(e) => { e.preventDefault(); did(name)(); }} />;

/** Launch's people, as Share at the foot of its side panel shows them to its admin. */
const LAUNCH_PEOPLE: WsShareRow[] = [ART, PRIYA, KOFI, INES].map((p, i) => ({ id: p.id, people: [p], name: i === 0 ? `${p.name} (you)` : p.name, sub: p.email, role: { label: i === 0 ? 'Admin' : 'Can edit' } }));

/** The side panel of Launch, a workspace kept by hand: Home, its pages, the calls kept in it, Trash, and who can open it. */
function LaunchSide({ at, onGo, sharing = false }: { at: string; onGo: (to: string) => void; sharing?: boolean | undefined }) {
  const [picker, setPicker] = useState(false);
  const [press, setPress] = useState(true);
  const [share, setShare] = useState(sharing);
  const [query, setQuery] = useState('');
  return (
    <WsSide brand={<a href="#" aria-label="Alcove, Home" onClick={(e) => e.preventDefault()}><Logo size={22} /></a>}
      space={{ name: 'Launch', mark: <WsMark name="Launch" />, picker: pop(<p className="wf-none">Your workspaces, and a new one.</p>, [picker, setPicker]) }}
      onSearch={did('onSearch')} searchKeys="⌘K" foot={<WsTrashRow count={2} onOpen={() => onGo('trash')} current={at === 'trash'} />} sealed="Priya, Kofi, Ines and you can open it"
      share={pop(<WsShareSheet title="People in Launch" query={query} onQuery={setQuery} onAdd={did('onAdd')} rows={LAUNCH_PEOPLE} />, [share, setShare])}>
      <WsRow id="place:home" kind="place" icon="home" name="Home" current={at === 'home'} onOpen={() => onGo('home')} />
      <WsSection label="Pages" add={pop(<p className="wf-none">New document, folder or board</p>, [false, did('onAdd')])} addLabel="New document, folder or board" />
      <WsRow id="plan" name="Launch plan" faces={[PRIYA]} current={at === 'plan'} onOpen={() => onGo('plan')} />
      <WsRow id="board" kind="board" name="Launch board" current={at === 'board'} onOpen={() => onGo('board')} />
      <WsRow id="press" kind="folder" name="Press" open={press} onOpen={() => setPress(!press)} onTwist={() => setPress(!press)} />
      {press && <WsRow id="press-list" name="Press list" depth={1} current={at === 'press-list'} onOpen={() => onGo('press-list')} />}
      {press && <WsRow id="press-post" name="Launch post draft" depth={1} tag="New" current={at === 'press-post'} onOpen={() => onGo('press-post')} />}
      <WsRow id="runbook" name="Status page runbook" current={at === 'runbook'} onOpen={() => onGo('runbook')} />
      <WsSection label="Calls" />
      <WsRow id="call-27" kind="call" icon="calls" name="Launch planning · 27 Oct" out onOpen={did('openCall')} />
      <WsRow id="call-13" kind="call" icon="calls" name="Launch planning · 13 Oct" out onOpen={did('openCall')} />
    </WsSide>
  );
}

/** Who else is here, each with a card. */
function useFaces(): WsFace[] {
  const [open, setOpen] = useState(false);
  return [{ person: PRIYA, card: pop(<p className="wf-none">Priya is in Launch plan.</p>, [open, setOpen]) }];
}

/** The line on what it's for, which an admin writes in place. */
function About({ admin = true, start = 'Everything for the launch on Wednesday 18 November: the plan, the press list, and the planning call every other Tuesday.' }: { admin?: boolean | undefined; start?: string | undefined }) {
  const [text, setText] = useState(start);
  const [editing, setEditing] = useState(false);
  const field: WsNaming | null = editing ? { name: text, placeholder: 'What this workspace is for', onCancel: () => setEditing(false), onCommit: (to) => { setEditing(false); setText(to.trim()); } } : null;
  return <WsAbout text={text} editing={field} onEdit={admin ? () => setEditing(true) : undefined} />;
}

/** Launch's Home: its name on the evening, its line, its people, what was edited lately and its calls. */
function LaunchHome() {
  return (
    <div className="wf-home-scroll">
      <WsHomeBand name="Launch" />
      <div className="wf-home">
        <About />
        <WsPeopleLine people={[PRIYA, KOFI, INES, ART]} line="Priya, Kofi, Ines and you" onOpen={did('onPeople')} />
        <WsHomeSection title="Recently edited">
          <div className="wf-cards">
            <FileCard size="lg" kind="doc" name="Launch plan" by="Edited at 08:40" onOpen={did('onOpen')} thumb={{ lines: [{ text: 'The launch moves to Wednesday 18 November.' }, { text: 'What goes out' }, { text: 'Paying for minutes of notes', mark: 'dot' }, { text: 'A monthly option on the team plan', mark: 'dot' }] }} />
            <FileCard size="lg" kind="doc" name="Press list" by="Edited Tue 27 Oct" onOpen={did('onOpen')} thumb={{ lines: [{ text: 'Three trade titles', mark: 'dot' }, { text: 'Two founders’ newsletters', mark: 'dot' }, { text: 'Embargo: 18 Nov, 09:00', mark: 'done' }] }} />
            <FileCard size="lg" kind="board" name="Launch board" by="Edited Tue 27 Oct" onOpen={did('onOpen')} />
          </div>
        </WsHomeSection>
        <WsHomeSection title="Calls">
          <div className="wf-rows">
            <CallRow soon who={{ faces: [ART, PRIYA, INES] }} title="Launch planning" open={link('openCall')} tag={{ icon: 'repeat', text: 'Every other Tuesday' }} line="Priya, Ines and you" when={{ at: '16:00', length: 'Tue 10 Nov' }} />
            <CallRow who={{ faces: [ART, PRIYA, INES] }} title="Launch planning" open={link('openCall')} gist="The launch moves to the 18th. Sign-ups are back up after the pricing change." chips={<CallChip kind="decide">1 to confirm</CallChip>} when={{ at: 'Tue 27 Oct', length: '38 min' }} />
          </div>
        </WsHomeSection>
      </div>
    </div>
  );
}

/** A page's top, as the editor puts its title and what's under it. */
function LaunchPage() {
  return (
    <div className="wd"><div className="wd-scroll"><div className="wd-page">
      <h1 className="wd-title">Launch plan</h1>
      <div className="wd-by-slot"><WsDocMeta from={{ label: 'From Launch planning, Tue 27 Oct', onClick: did('openCall') }} person={PRIYA} name="Priya" edited="Edited at 08:40" /></div>
      <p className="ac-body">The launch moves to Wednesday 18 November. Sign-ups are back up since the pricing change, so the date holds.</p>
    </div></div></div>
  );
}

/** The whole frame, at `at`, with the bar put where the frame keeps it. `sharing`: who can open it, at the foot, is pressed. */
function Frame({ phone = 'page', start = 'home', sharing = false }: { phone?: WsPhone | undefined; start?: string | undefined; sharing?: boolean | undefined }) {
  const [at, setAt] = useState(start);
  const [shows, setShows] = useState<WsPhone>(phone);
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [share, setShare] = useState(false);
  const [more, setMore] = useState(false);
  const faces = useFaces();
  const home = at === 'home';
  const go = (to: string) => { setAt(to); setShows('page'); };
  return (
    <WsFrame side={<LaunchSide at={at} onGo={go} sharing={sharing} />} bar={setBar} phone={shows} home={home}>
      {bar && createPortal(
        <WsBar back={{ label: 'Drive', onClick: did('onBack') }} crumbs={home ? [] : [{ label: 'Launch', onClick: () => setAt('home') }, { label: 'Launch plan' }]}
          up={shows === 'page' ? { label: 'Launch', onClick: () => setShows('list') } : undefined} save={home ? undefined : 'saved'}
          here={{ faces, line: hereLine(['Priya']) }} share={pop(<p className="wf-none">Who has it.</p>, [share, setShare])} more={pop(<p className="wf-none">More.</p>, [more, setMore])}
          onExit={did('onExit')} me={<Avatar person={ART} size={30} />} />,
        bar
      )}
      {home ? <LaunchHome /> : <LaunchPage />}
    </WsFrame>
  );
}

const meta = {
  title: 'Components/Workspace/Full screen',
  component: WsFrame,
  subcomponents: { WsSide, WsBar, WsMark, WsHomeBand, WsAbout, WsPeopleLine, WsHomeSection, WsDocMeta },
  parameters: { layout: 'fullscreen' },
  render: () => <Frame />
} satisfies Meta<typeof WsFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Home: the name on the evening after sunset under a clear bar; the line, the people, what was edited lately, the calls. */
export const Home: Story = {};
/** A page: the bar's path, Saved and who else is here; under the title, the call it came from and who made it. */
export const APage: Story = { render: () => <Frame start="plan" /> };
/** On a phone the workspace's pages come first, under the way back to where it was opened from. */
export const PhonePages: Story = { ...PHONE, render: () => <Frame phone="list" /> };
/** A page on a phone: back goes to the workspace's pages. */
export const PhonePage: Story = { ...PHONE, render: () => <Frame start="plan" /> };
/** The frame waiting for its workspace: the side panel dark and empty. */
export const Waiting: Story = { render: () => <WsFrame /> };
/**
 * Who can open it, at the foot of the side panel, pressed: who's in the workspace (`share`), from any page of it, a call's own
 * workspace too, which has no Home. Left out for someone who isn't in it, for whom it's only said.
 */
export const WhoCanOpenIt: Story = { render: () => <Frame start="plan" sharing /> };
export const WhoCanOpenItPhone: Story = { ...PHONE, render: () => <Frame phone="list" sharing /> };

/** The line on what it's for: said; for an admin, pressed to write in place; nothing said yet; for someone who can only read it. */
export const TheLine: StoryObj = {
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ display: 'grid', gap: 28, maxWidth: 680 }}>
      <About />
      <About start="" />
      <About admin={false} />
    </div>
  )
};
/** A workspace's mark, by its first letter; a call's own workspace has the call's camera. */
export const Marks: StoryObj = {
  parameters: { layout: 'padded' },
  render: () => <div className="wf-side dark" style={{ flexDirection: 'row', gap: 12, padding: 16 }}><WsMark name="Launch" /><WsMark name="Hiring" /><WsMark name="Team standup · 4 Nov" call /></div>
};
