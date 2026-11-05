/*
 * Presenting a document to everyone in a call, playing a video for everyone, and a document's history. Whoever presents
 * sees a strip saying what everyone sees (WsPresentStrip) and their own view beside the page (WsPresenterView: where
 * they are, Back and Next, their notes and Stop presenting); everyone else gets the strip with Work on my own, which
 * becomes Back to the presentation. Each section swaps in place (WsFade). A video played for everyone has a bar over the
 * dock (WsPlayBar), with the controls for whoever started it and a volume that's yours alone. History (WsHistory) sits
 * beside the page, newest first; pressing a version shows it, and Restore brings it back.
 */
import {
  Button, WsDoc, WsDocHead, WsFade, WsHistory, WsPage, WsPane, WsPlayBar, WsPresentStrip, WsPresenterView, WsScroll, WsToasts, wsToast,
  type WsPlaying, type WsPresentMine, type WsPresentTheirs
} from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { useArgs } from 'storybook/preview-api';
import { Box, Stack, did } from '../../../src/component';
import { AIKO, PRIYA } from '../../../src/world/people';
import { DocOf, ListOf, PageText, Presentation, SECTIONS, SectionText, TEXT, VERSIONS, first, useToasts, useWorkspace } from './parts';

const NOTES = 'Thank Aiko for the pilot numbers. Mention the 20th if legal agrees.';
const meta = {
  title: 'Components/Workspace/Presenting',
  component: WsPresenterView,
  subcomponents: { WsPresentStrip, WsFade, WsPlayBar, WsHistory },
  parameters: { layout: 'padded' }
} satisfies Meta<typeof WsPresenterView>;
export default meta;
type Story = StoryObj<typeof meta>;

/* ---------- presenting ---------- */

/**
 * Launch plan presented in a call, answering. Your own: Back and Next move a section, and Stop presenting takes you
 * back to the workspace, where Present starts again. Someone else's: Work on my own goes back to the workspace with
 * their strip in place of the document's head, and Back to the presentation returns.
 */
function Presenting({ mine }: { mine: boolean }) {
  const ws = useWorkspace({ call: true, presenting: mine });
  const [own, setOwn] = useState(false);
  let pane;
  if (ws.presenting) pane = <Presentation mine onStop={() => { ws.setPresenting(false); ws.say(wsToast.stoppedPresenting()); }} />;
  else if (!mine && !own) pane = <Presentation mine={false} onAway={() => setOwn(true)} />;
  else {
    pane = (
      <WsPane>
        <ListOf ws={ws} />
        <DocOf ws={ws} onToggleList={did('onToggleList')}
          strip={mine ? undefined : <WsPresentStrip name="Launch plan" presenter={PRIYA} by={first(PRIYA)} away onToggle={() => setOwn(false)} />} />
      </WsPane>
    );
  }
  return <><Box width="100%" height={600}>{pane}</Box><WsToasts toasts={ws.toasts} /></>;
}
const PRESENTER = { at: 2, total: SECTIONS.length, part: 'Messaging', next: 'Open questions', notes: NOTES, onNotes: did('onNotes'), onBack: did('onBack'), onNext: did('onNext'), onStop: did('onStop') };
export const Yours: Story = { name: 'Presenting: your own', args: PRESENTER, parameters: { controls: { disable: true } }, render: () => <Presenting mine /> };
export const Theirs: Story = { name: 'Presenting: someone else’s', args: PRESENTER, parameters: { controls: { disable: true } }, render: () => <Presenting mine={false} /> };

/** Only the presenter sees this. Back and Next move through Launch plan's three sections, and the notes are yours to write. */
const presenter: Story['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsPresenterView>>();
  const goTo = (at: number) => {
    const n = Math.min(Math.max(at, 1), args.total);
    update({ at: n, part: SECTIONS[n - 1]?.name ?? 'Launch plan', next: SECTIONS[n]?.name ?? null });
  };
  return (
    <Box width={288} height={520}>
      <WsPresenterView {...args} onNotes={(notes) => { args.onNotes(notes); update({ notes }); }}
        onBack={() => { args.onBack(); goTo(args.at - 1); }} onNext={() => { args.onNext(); goTo(args.at + 1); }} />
    </Box>
  );
};
export const PresenterView: Story = { name: 'Presenter view: a section in the middle', args: PRESENTER, render: presenter };
/** The last section: nothing comes next. */
export const PresenterViewLast: Story = { name: 'Presenter view: the last section', args: { ...PRESENTER, at: 3, part: 'Open questions', next: null }, render: presenter };

/* ---------- the strip ---------- */

/** The strip at the top of a document: over the section being read, or over your own page when you're working on your own. */
function StripOver({ strip, reading, at }: { strip: ReactNode; reading: boolean; at: number }) {
  const checklist = TEXT.get('checklist');
  return (
    <Box width="100%" height={300}>
      <WsPane reading={reading} label={reading ? 'Launch plan, presented' : 'Workspace'}>
        <WsDoc>
          {strip}
          <WsScroll>
            <WsPage>{reading ? <SectionText at={at} /> : <PageText title="Launch checklist" by={checklist?.by} edited={checklist?.edited} lines={checklist?.lines ?? []} />}</WsPage>
          </WsScroll>
        </WsDoc>
      </WsPane>
    </Box>
  );
}
/** Yours: everyone sees this, and which section of how many. */
export const StripYours: StoryObj<WsPresentMine> = {
  name: 'Strip: yours', args: { mine: true, name: 'Launch plan', at: 2, total: SECTIONS.length },
  render: (args) => <StripOver reading at={args.at - 1} strip={<WsPresentStrip mine name={args.name} at={args.at} total={args.total} />} />
};
/** Someone else's: who's presenting what, and Work on my own. */
const theirs: StoryObj<WsPresentTheirs>['render'] = function Render(args) {
  const [, update] = useArgs<WsPresentTheirs>();
  return (
    <StripOver reading={!args.away} at={1}
      strip={<WsPresentStrip name={args.name} presenter={args.presenter} by={args.by} away={args.away} onToggle={() => { args.onToggle(); update({ away: !args.away }); }} />} />
  );
};
export const StripTheirs: StoryObj<WsPresentTheirs> = {
  name: 'Strip: someone else’s', args: { name: 'Launch plan', presenter: PRIYA, by: first(PRIYA), away: false, onToggle: did('onToggle') }, argTypes: { presenter: { control: false } }, render: theirs
};
/** Working on your own while they present: the strip brings you back. */
export const StripAway: StoryObj<WsPresentTheirs> = {
  name: 'Strip: someone else’s, working on your own', args: { name: 'Launch plan', presenter: PRIYA, by: first(PRIYA), away: true, onToggle: did('onToggle') }, argTypes: { presenter: { control: false } }, render: theirs
};

/* ---------- swapping in place ---------- */

/** Next section changes the id, and what's inside cross-fades (240 ms). */
const fading: StoryObj<typeof WsFade>['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsFade>>();
  const at = Number(args.id) || 0;
  return (
    <Stack>
      <Button size="sm" iconRight="right" onClick={() => update({ id: String((at + 1) % SECTIONS.length) })}>Next section</Button>
      <Box width="100%" height={420}>
        <WsPane reading label="Launch plan, presented">
          <WsDoc><WsScroll><WsFade id={args.id}><WsPage><SectionText at={at} /></WsPage></WsFade></WsScroll></WsDoc>
        </WsPane>
      </Box>
    </Stack>
  );
};
export const Fade: StoryObj<typeof WsFade> = { name: 'Fade', args: { id: '0', children: null }, argTypes: { children: { table: { disable: true } } }, render: fading };

/* ---------- playing a video for everyone ---------- */

const LENGTH = 90;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const FILM: WsPlaying = { title: 'Harbour launch film', mine: true, by: 'Art', on: true, at: clock(42), progress: 42 / LENGTH, volume: 0.8 };

/**
 * The bar over the dock, under the workspace in a call. It runs while it plays; whoever started it can pause it or stop
 * it for everyone, and the volume is yours alone. Once it's stopped, the button plays it again.
 */
function Playing(args: ComponentProps<typeof WsPlayBar>) {
  const [playing, setPlaying] = useState(args.playing);
  const ws = useWorkspace({ call: true });
  const on = playing?.on ?? false;
  useEffect(() => {
    if (!on) return undefined;
    const t = window.setInterval(() => setPlaying((p) => {
      if (!p) return p;
      const s = Math.min(LENGTH, Math.round(p.progress * LENGTH) + 1);
      return { ...p, at: clock(s), progress: s / LENGTH, on: s < LENGTH };
    }), 1000);
    return () => clearInterval(t);
  }, [on]);
  return (
    <Stack>
      {playing === null && <Button size="sm" icon="play" onClick={() => setPlaying({ ...FILM, at: clock(0), progress: 0 })}>Play Harbour launch film for everyone</Button>}
      <Box width="100%" height={560}><WsPane><ListOf ws={ws} /><DocOf ws={ws} onToggleList={did('onToggleList')} /></WsPane></Box>
      <WsPlayBar playing={playing} onToggle={() => { args.onToggle(); setPlaying((p) => p && { ...p, on: !p.on }); }}
        onStop={() => { args.onStop(); setPlaying(null); }} onVolume={(volume) => { args.onVolume(volume); setPlaying((p) => p && { ...p, volume }); }} />
    </Stack>
  );
}
type PlayStory = StoryObj<typeof WsPlayBar>;
const PLAY = { playing: FILM, onToggle: did('onToggle'), onStop: did('onStop'), onVolume: did('onVolume') };
const playTypes: PlayStory['argTypes'] = { playing: { control: 'object' } };
export const PlayYours: PlayStory = { name: 'Play bar: yours, playing', args: PLAY, argTypes: playTypes, render: (args) => <Playing key={JSON.stringify(args.playing)} {...args} /> };
export const PlayPaused: PlayStory = { name: 'Play bar: yours, paused', args: { ...PLAY, playing: { ...FILM, on: false } }, argTypes: playTypes, render: (args) => <Playing key={JSON.stringify(args.playing)} {...args} /> };
/** Aiko started it: the bar says so, and there's nothing to press but your own volume. */
export const PlayTheirs: PlayStory = {
  name: 'Play bar: someone else’s', args: { ...PLAY, playing: { ...FILM, mine: false, by: first(AIKO) } }, argTypes: playTypes, render: (args) => <Playing key={JSON.stringify(args.playing)} {...args} />
};
/** Stopped, or nothing playing: the bar drops away. */
export const PlayGone: PlayStory = { name: 'Play bar: gone', args: { ...PLAY, playing: null }, argTypes: playTypes, render: (args) => <Playing key={JSON.stringify(args.playing)} {...args} /> };

/* ---------- history ---------- */

/** History beside Launch plan: a version shows on the page as you press it; Restore and Close put it away. */
function History(args: ComponentProps<typeof WsHistory> & { update: (next: Partial<ComponentProps<typeof WsHistory>>) => void }) {
  const [open, setOpen] = useState(true);
  const { toasts, say } = useToasts();
  const plan = TEXT.get('plan');
  const version = VERSIONS.find((v) => v.id === args.selected);
  const close = () => { setOpen(false); args.update({ selected: VERSIONS[0]?.id ?? '' }); };
  return (
    <Stack>
      {!open && <Button size="sm" icon="history" onClick={() => setOpen(true)}>History</Button>}
      <Box width="100%" height={560}>
        <WsPane>
          <WsDoc>
            <WsDocHead crumbs={['Product', 'Launch plan']} save="saved" onToggleList={did('onToggleList')} />
            <WsScroll>
              <WsFade id={args.selected}>
                <WsPage>
                  <PageText title="Launch plan" by={plan?.by} edited={plan?.edited} lines={(plan?.lines ?? []).slice(0, version?.lines ?? 9)} />
                </WsPage>
              </WsFade>
            </WsScroll>
          </WsDoc>
          {open && (
            <WsHistory versions={args.versions} selected={args.selected} onSelect={(id) => { args.onSelect(id); args.update({ selected: id }); }}
              onRestore={() => { args.onRestore(); close(); if (version) say(wsToast.restoredVersion(version.when, did('onUndo'))); }} onClose={() => { args.onClose(); close(); }} />
          )}
        </WsPane>
      </Box>
      <WsToasts toasts={toasts} />
    </Stack>
  );
}
const history: StoryObj<typeof WsHistory>['render'] = function Render(args) {
  const [, update] = useArgs<ComponentProps<typeof WsHistory>>();
  return <History {...args} update={update} />;
};
const HISTORY = { versions: VERSIONS, selected: 'v-now', onSelect: did('onSelect'), onRestore: did('onRestore'), onClose: did('onClose') };
const historyTypes: StoryObj<typeof WsHistory>['argTypes'] = { versions: { control: false }, selected: { control: 'inline-radio', options: VERSIONS.map((v) => v.id) } };
/** Grouped by call, newest first. The first is now, so it has no Restore. */
export const HistoryNow: StoryObj<typeof WsHistory> = { name: 'History: versions', args: HISTORY, argTypes: historyTypes, render: history };
/** The last check-in's version, on the page, with Restore. */
export const HistoryPast: StoryObj<typeof WsHistory> = { name: 'History: a past version, with Restore', args: { ...HISTORY, selected: 'v-last' }, argTypes: historyTypes, render: history };
