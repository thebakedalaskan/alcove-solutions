/*
 * Toast: a short confirmation in the past tense, bottom-centre and inverted, with an optional action such as Undo. A
 * screen says one with `useToast()`: a check unless it names another icon (`icon: false` for none), gone after 3.6
 * seconds unless `ms` says otherwise, and at most three at once. ToastProvider holds them; the app's root gives it, as the
 * preview does to every story here. Where a control bar runs along the bottom (a call, the lobby, Record), the screen
 * calls `useRaisedToasts()` and they stand clear of it while it's up. A failure is said with `toastFailure` (the app's
 * lib/failed.ts): the error's words with the cross, for eight seconds, and Copy reference when Alcove answered.
 */
import { AlcoveApiError } from '@alcove/api';
import { Button, CallDock, DockButton, DockLeave, ToastProvider, useRaisedToasts, useToast, type IconName, type ToastOptions } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef } from 'react';
import { toastFailure } from '~/lib/failed';
import { Row, did, onStage } from '../../../src/component';

/** A button that does something and says so with a toast, as a screen would. */
function Say({ label, icon, text, o }: { label: string; icon: IconName; text: string; o?: ToastOptions | undefined }) {
  const toast = useToast();
  return <Button icon={icon} onClick={() => toast(text, o)}>{label}</Button>;
}

const SCHEDULED = { text: 'On your calendar. 2 people get an invitation.', o: { icon: 'cal', ms: 6000, action: { label: 'Undo', onClick: did('Undo') } } } satisfies { text: string; o: ToastOptions };
const AWAY = { text: 'You were away for 4 min', o: { icon: 'history', ms: 12_000, action: { label: 'Catch up', onClick: did('Catch up') } } } satisfies { text: string; o: ToastOptions };

/** A save Alcove couldn't take: it answered, so the failure has a request's ID to quote. */
const REFUSED = new AlcoveApiError('unavailable', 'Alcove couldn’t answer just now. Try again in a moment.', { requestId: 'q3Xv9LwT0aZk2PbN' });
/** A request that never reached Alcove: there's no reference to give. */
const UNREACHED = new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.');

/** A button whose action fails, said as the app says a failure. */
function Fail({ label, icon, error }: { label: string; icon: IconName; error: unknown }) {
  const toast = useToast();
  return <Button icon={icon} onClick={() => toastFailure(toast, error)}>{label}</Button>;
}

/** Says a failure once as it opens, and again on request. */
function FailedOnOpening({ error, again }: { error: unknown; again: string }) {
  const toast = useToast();
  const said = useRef(false);
  useEffect(() => {
    if (said.current) return;
    said.current = true;
    toastFailure(toast, error);
  }, [toast, error]);
  return <Button icon="reset" onClick={() => toastFailure(toast, error)}>{again}</Button>;
}

/** Says it once as it opens, and again on request. */
function SaidOnOpening({ text, o, again }: { text: string; o: ToastOptions; again: string }) {
  const toast = useToast();
  const said = useRef(false);
  useEffect(() => {
    if (said.current) return;
    said.current = true;
    toast(text, o);
  }, [toast, text, o]);
  return <Button icon="reset" onClick={() => toast(text, o)}>{again}</Button>;
}

/** A screen with a control bar along the bottom: while it's up, toasts stand clear of the bar. */
function WithADock() {
  useRaisedToasts();
  return (
    <>
      <p style={{ maxWidth: 420, textAlign: 'center', fontSize: 14, color: 'var(--stage-ink-2)' }}>On a wide window toasts sit left of the dock; on a narrower one, above it.</p>
      <SaidOnOpening {...AWAY} again="Say it again" />
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 20, display: 'flex', justifyContent: 'center' }}>
        <CallDock>
          <DockButton icon="mic" label="Mute" onClick={did('Mute')} />
          <DockButton icon="video" label="Turn camera off" onClick={did('Turn camera off')} />
          <DockButton icon="screen" label="Share your screen" onClick={did('Share your screen')} />
          <DockLeave onClick={did('Leave')} />
        </CallDock>
      </div>
    </>
  );
}

const meta = {
  title: 'Components/Feedback/Toast',
  component: ToastProvider,
  parameters: { layout: 'centered' },
  args: { children: null },
  argTypes: { children: { control: false } }
} satisfies Meta<typeof ToastProvider>;
export default meta;
type Story = StoryObj<typeof meta>;

/** What happened, in the past tense, with the check. Press the button. */
export const Confirmation: Story = { render: () => <Say label="Bookmark this moment" icon="bookmark" text="Bookmarked in your own notes." /> };
/** With Undo: pressing it takes the change back and the toast goes. It stays six seconds, to leave time to. */
export const WithUndo: Story = { name: 'With undo', render: () => <Say label="Schedule" icon="cal" {...SCHEDULED} /> };
/** Its own icon, for what it's about. */
export const WithAnIcon: Story = { name: 'With an icon', render: () => <Say label="Copy the link" icon="link" text="Link copied. It works once, on one device." o={{ icon: 'link' }} /> };
/** No icon at all. */
export const WithoutAnIcon: Story = { name: 'Without an icon', render: () => <Say label="Disconnect the calendar" icon="cal" text="Google Calendar is disconnected." o={{ icon: false }} /> };
/** Shown as the story opens: the icon, what happened and its action. */
export const ShownOnOpening: Story = { name: 'Shown on opening', render: () => <SaidOnOpening {...SCHEDULED} again="Show it again" /> };
/**
 * A failure: what went wrong, with the cross, for eight seconds, and Copy reference, since Alcove answered. Pressing it
 * copies the request's ID and says so: the ID finds that request's lines in the server's log, and says nothing about anyone.
 */
export const AFailure: Story = { name: 'A failure', render: () => <FailedOnOpening error={REFUSED} again="Show it again" /> };
/** A request that never reached Alcove has no reference: the failure is said with nothing to press. */
export const AFailureWithoutAConnection: Story = { name: 'A failure without a connection', render: () => <FailedOnOpening error={UNREACHED} again="Show it again" /> };
/** Every kind, one button each. Press several: three show at most, the oldest going first. */
export const EveryKind: Story = {
  name: 'Every kind',
  render: () => (
    <Row>
      <Say label="Bookmark this moment" icon="bookmark" text="Bookmarked in your own notes." />
      <Say label="Schedule" icon="cal" {...SCHEDULED} />
      <Say label="Copy the link" icon="link" text="Link copied. It works once, on one device." o={{ icon: 'link' }} />
      <Say label="Disconnect the calendar" icon="cal" text="Google Calendar is disconnected." o={{ icon: false }} />
      <Fail label="Save a setting" icon="settings" error={REFUSED} />
    </Row>
  )
};
/** `useRaisedToasts()` in a call: the toast stands clear of the dock, never over it. */
export const RaisedAboveADock: Story = { name: 'Raised above a dock', ...onStage, render: () => <WithADock /> };
