/*
 * FlowView: one view of the call modal, which asks one thing at a time. Its head stays put: FlowHead (one heading and
 * the way out) on the first view, FlowSteps after it (where you are in Who, When and Details, with Back; `busy` holds
 * Back while a step saves). The body between them (FlowBody) scrolls when it has to, and slides in from the side it's
 * coming from: going back (`back`), from the other side. The foot (FlowFoot) says what will happen, or offers a quiet way
 * out (`lead`), then what to press. useSmoothHeight lets the modal's box grow and shrink from one step to the next
 * instead of jumping.
 */
import type { Person } from '@alcove/api';
import { Avatar, Button, Faces, FlowBody, FlowFoot, FlowHead, FlowRow, FlowSteps, FlowView, Icon, IconButton, Modal, PersonToken, Segmented, TimeCard, WayCard, useSmoothHeight } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { useArgs } from 'storybook/preview-api';
import { ModalFrame, did } from '../../../src/component';
import { AIKO, INES, KOFI, LENA, MAYA, PRIYA } from '../../../src/world/people';

const STEPS = ['Who', 'When', 'Details'] as const;
const close = did('onClose');
const backOut = did('onBack');
const step = (at: number) => Math.max(0, Math.min(STEPS.length - 1, Math.round(at)));

/** What these stories control besides the view itself: the step (`at`), whether it was come back to, and whether it's saving. */
type Args = ComponentProps<typeof FlowView> & { at: number; back: boolean; busy: boolean };

/** Who you're often with, and what they do. */
const OFTEN: readonly (readonly [Person, string])[] = [[AIKO, 'Engineering'], [MAYA, 'Finance'], [INES, 'Co-founder'], [LENA, 'Research']];

/** Who: Priya and Kofi picked, and who else to add. In the modal, typing goes straight into the field (`focus`). */
function Who({ back, heading = 'Who’s it with?', focus = false }: { back: boolean; heading?: string | undefined; focus?: boolean | undefined }) {
  return (
    <FlowBody back={back}>
      <h2>{heading}</h2>
      <div className="cf-field">
        <PersonToken people={[PRIYA]} label="Priya" title={PRIYA.email} removeLabel={`Remove ${PRIYA.name}`} onRemove={did('onRemove')} />
        <PersonToken people={[KOFI]} label="Kofi" title={KOFI.email} removeLabel={`Remove ${KOFI.name}`} onRemove={did('onRemove')} />
        <input type="text" aria-label="Add people" placeholder="Add someone else" autoComplete="off" spellCheck={false} autoFocus={focus} />
      </div>
      <div className="cf-k">Often with you</div>
      <div className="cf-list">
        {OFTEN.map(([p, title]) => (
          <button key={p.email} type="button" className="cf-row" onClick={did('onAdd')}>
            <span className="cf-face"><Avatar person={p} size={36} /></span>
            <span className="min-w-0"><b className="ac-clamp-1">{p.name}</b><small className="ac-clamp-1">{title}</small></span>
            <span className="plus"><Icon name="plus" size={17} /></span>
          </button>
        ))}
      </div>
    </FlowBody>
  );
}

/** The times that suit all three, soonest first: the best is already picked. */
const TIMES = [
  { id: 'thu-14', day: 'Tomorrow', date: 'Thu 5 Nov', short: 'Thu 14:00', hour: 14, minute: 0 },
  { id: 'thu-1630', day: 'Tomorrow', date: 'Thu 5 Nov', short: 'Thu 16:30', hour: 16, minute: 30 },
  { id: 'fri-11', day: 'Fri 6 Nov', date: 'Fri 6 Nov', short: 'Fri 11:00', hour: 11, minute: 0 }
] as const;
type Time = (typeof TIMES)[number];
const hm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** "Thu 5 Nov, 14:00 – 14:30" */
const timeLine = (t: Time, length: number) => `${t.date}, ${hm(t.hour * 60 + t.minute)} – ${hm(t.hour * 60 + t.minute + length)}`;

/** What's been chosen so far: it carries from step to step, as the app's draft does. */
interface Draft { time: Time; length: string }

/** When: three times that work, how long, and how it repeats. */
function When({ back, draft, onDraft, onNext }: { back: boolean; draft: Draft; onDraft: (d: Draft) => void; onNext: () => void }) {
  return (
    <>
      <FlowBody back={back}>
        <h2>When works for everyone?</h2>
        <p className="cf-sub">All 3 of you are free at these times.</p>
        <div className="cf-times">
          {TIMES.map((t) => <TimeCard key={t.id} day={t.day} time={hm(t.hour * 60 + t.minute)} picked={t.id === draft.time.id} onClick={() => onDraft({ ...draft, time: t })} />)}
        </div>
        <div className="cf-bar">
          <Segmented label="How long" value={draft.length} onChange={(length) => onDraft({ ...draft, length })} options={[{ value: '30', label: '30 min' }, { value: '45', label: '45 min' }, { value: '60', label: '1 h' }]} />
          <button type="button" className="lk" onClick={did('onPickAnother')}>Pick another time</button>
        </div>
        <div className="cf-rows"><FlowRow icon="repeat" title="Doesn’t repeat" expanded={false} onClick={did('onRepeat')} /></div>
      </FlowBody>
      <FlowFoot><Button variant="primary" onClick={onNext}>Use {draft.time.short}</Button></FlowFoot>
    </>
  );
}

/** Details: the call as it will be, ready to name. The rows step back to When and Who. */
function Details({ back, busy, draft, onWhen }: { back: boolean; busy: boolean; draft: Draft; onWhen: () => void }) {
  return (
    <>
      <FlowBody back={back}>
        <input className="cf-title" type="text" aria-label="Name the call" defaultValue="Design sync" autoComplete="off" />
        <div className="cf-rows" style={{ marginTop: 14 }}>
          <FlowRow icon="cal" title={timeLine(draft.time, Number(draft.length))} sub="Doesn’t repeat" disabled={busy} onClick={onWhen} />
          <FlowRow icon="people" title="Priya and Kofi" sub="2 people" end={<Faces people={[PRIYA, KOFI]} size={24} max={4} />} disabled={busy} onClick={did('onWho')} />
          <FlowRow icon="notes" on title="Notes and transcript" sub="Everyone invited gets them" expanded={false} onClick={did('onNotes')} />
          <FlowRow icon="fileText" title="Documents" sub="Add from a workspace" disabled={busy} onClick={did('onDocuments')} />
        </div>
      </FlowBody>
      <FlowFoot summary="2 people get an invitation.">
        <Button variant="primary" loading={busy} onClick={did('onSchedule')}>Schedule</Button>
      </FlowFoot>
    </>
  );
}

/** Scheduling, a step at a time: the foot's button steps on, Back steps back. */
function Scheduling({ at, back, busy, focus = false, onAt, onClose }: {
  at: number; back: boolean; busy: boolean; focus?: boolean | undefined; onAt: (at: number, back: boolean) => void; onClose: () => void;
}) {
  const now = step(at);
  const [draft, setDraft] = useState<Draft>({ time: TIMES[0], length: '30' });
  return (
    <FlowView>
      <FlowSteps steps={STEPS} at={now} busy={busy} onBack={() => { if (now > 0) onAt(now - 1, true); else backOut(); }} onClose={onClose} />
      {now === 0 && <Who key="who" back={back} focus={focus} />}
      {now === 0 && <FlowFoot><Button variant="primary" onClick={() => onAt(1, false)}>Find a time</Button></FlowFoot>}
      {now === 1 && <When key="when" back={back} draft={draft} onDraft={setDraft} onNext={() => onAt(2, false)} />}
      {now === 2 && <Details key="details" back={back} busy={busy} draft={draft} onWhen={() => onAt(1, true)} />}
    </FlowView>
  );
}

/** Scheduling in the real modal, over the page, its box changing height smoothly between steps. Closed, a button opens it again. */
function InTheRealModal({ at, back, busy, onAt }: { at: number; back: boolean; busy: boolean; onAt: (at: number, back: boolean) => void }) {
  const [open, setOpen] = useState(true);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const now = step(at);
  useSmoothHeight(box, String(now));
  return (
    <>
      <Button icon="cal" onClick={() => setOpen(true)}>Schedule a call</Button>
      <Modal ref={setBox} open={open} onOpenChange={setOpen} label="Schedule a call" className="cf-modal">
        <Scheduling at={now} back={back} busy={busy} focus onAt={onAt} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

const meta = {
  title: 'Components/Starting a call/FlowView',
  component: FlowView,
  subcomponents: { FlowHead, FlowSteps, FlowBody, FlowFoot },
  args: { children: null, at: 0, back: false, busy: false },
  argTypes: {
    at: { control: { type: 'inline-radio', labels: { 0: 'Who', 1: 'When', 2: 'Details' } }, options: [0, 1, 2] },
    back: { control: 'boolean' },
    busy: { control: 'boolean' },
    children: { control: false },
    className: { control: false }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <ModalFrame><Scheduling at={args.at} back={args.back} busy={args.busy} onAt={(at, back) => update({ at, back })} onClose={close} /></ModalFrame>;
  }
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<typeof meta>;

const noControls = { controls: { disable: true } };

/** The first view: one heading and the way out (FlowHead), then the two ways to start. */
export const WithAHead: Story = {
  name: 'With a head',
  parameters: noControls,
  render: () => (
    <ModalFrame>
      <FlowView>
        <FlowHead title="Start a call" onClose={close} />
        <div className="cf-ways">
          <WayCard art="now" title="Start now" kbd="↵" onClick={did('onNow')}>Ring your team in, or share a link.</WayCard>
          <WayCard art="later" title="Schedule for later" kbd="S" onClick={did('onLater')}>Find a time that works for everyone.</WayCard>
        </div>
      </FlowView>
    </ModalFrame>
  )
};
/** Who, When and Details, one at a time (`at`). The foot's button steps on and Back steps back, each body sliding in from its side. */
export const Steps: Story = {};
/** Come back to (`back`): the body slides in from the left, the side it's coming from. */
export const GoingBack: Story = { name: 'Going back', args: { at: 1, back: true } };
/** The last step's foot: what will happen when it's pressed, then the button. */
export const FootWithASummary: Story = { name: 'Foot with a summary', args: { at: 2 } };
/** Saving (`busy`): Back holds still, the rows that step elsewhere wait, and the button says it's busy. */
export const Busy: Story = { args: { at: 2, busy: true } };
/** A quiet way out on the foot's left (`lead`): a scheduled call's card, with Cancel this call apart from Copy link and Join. */
export const FootWithALead: Story = {
  name: 'Foot with a lead',
  parameters: noControls,
  render: () => (
    <ModalFrame>
      <FlowView>
        <FlowBody className="cf-card-h">
          <div className="cf-card-top">
            <div className="min-w-0">
              <h2 className="ac-clamp-2">Design sync</h2>
              <p className="when">Wed 4 Nov, 17:30 – 18:00</p>
            </div>
            <span className="end">
              <IconButton icon="pen" size={17} label="Rename this call" onClick={did('onRename')} />
              <IconButton icon="x" label="Close" onClick={close} />
            </span>
          </div>
          <div className="cf-rows" style={{ marginTop: 14 }}>
            <FlowRow icon="people" title="2 invited" sub="2 coming" end={<Faces people={[PRIYA, KOFI]} size={24} max={4} />} onClick={did('onWho')} />
            <FlowRow icon="cal" title="Change the time" sub="Wed 4 Nov at 17:30" onClick={did('onTime')} />
            <FlowRow icon="notes" on title="Notes and transcript" sub="Everyone invited gets them" onClick={did('onNotes')} />
            <FlowRow icon="fileText" title="Documents" sub="Bring something to the call" onClick={did('onDocuments')} />
          </div>
        </FlowBody>
        <FlowFoot lead={<Button variant="quiet" icon="trash" onClick={did('onCancel')}>Cancel this call</Button>}>
          <Button variant="secondary" icon="link" onClick={did('onCopyLink')}>Copy link</Button>
          <Button variant="primary" icon="video" onClick={did('onJoin')}>Join</Button>
        </FlowFoot>
      </FlowView>
    </ModalFrame>
  )
};
/** One view away from a call's card, changing who's coming: Back and the way out, with no steps to show. */
export const BackWithoutSteps: Story = {
  name: 'Back without steps',
  parameters: noControls,
  render: () => (
    <ModalFrame>
      <FlowView>
        <FlowSteps steps={[]} at={0} onBack={backOut} onClose={close} />
        <Who back={false} heading="Who’s coming?" />
        <FlowFoot summary="Everyone invited gets the update."><Button variant="primary" onClick={did('onSave')}>Save</Button></FlowFoot>
      </FlowView>
    </ModalFrame>
  )
};
/**
 * The real modal, over the page. Its box grows and shrinks smoothly as the steps change (useSmoothHeight), rather than
 * jumping at both edges at once. Closed, Schedule a call opens it again.
 */
export const InTheModal: Story = {
  name: 'In the modal',
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <InTheRealModal at={args.at} back={args.back} busy={args.busy} onAt={(at, back) => update({ at, back })} />;
  }
};
