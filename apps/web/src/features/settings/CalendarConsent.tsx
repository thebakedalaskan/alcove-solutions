import { Button, FlowBody, FlowFoot, FlowHead, FlowView, Modal } from '@alcove/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { calendarConnectUrl } from '~/lib/queries';

export function CalendarConsent() {
  const router = useRouter();
  const [going, setGoing] = useState(false);
  const cancel = () => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: '/home', replace: true });
  };
  useEffect(() => {
    // A Back from Google can restore this dialog as it was left, with the button busy.
    const restore = (event: PageTransitionEvent) => { if (event.persisted) setGoing(false); };
    addEventListener('pageshow', restore);
    return () => removeEventListener('pageshow', restore);
  }, []);
  const continueToGoogle = () => {
    setGoing(true);
    location.assign(calendarConnectUrl());
  };
  return (
    <main className="min-h-dvh bg-ground">
      <Modal open onOpenChange={(open) => { if (!open) cancel(); }} label="Connect Google Calendar" className="cf-modal">
        <FlowView>
          <FlowHead title="Connect Google Calendar" onClose={cancel} />
          <FlowBody className="space-y-3 text-ink-2">
            <p>Alcove reads event details on your primary calendar to show meetings on Home. To suggest call times, it sends Google the guest addresses and time range to check when people are busy.</p>
            <p>When you schedule, change, or cancel a call, Alcove can send its title, time, guest addresses, and join link to Google Calendar so Google can update the event and email your guests.</p>
            <p>If you turn a Calendar event into an Alcove call, Alcove keeps its title, time, and guests with the call. Agents you give calendar permission can read events and availability. You can disconnect Calendar in Settings.</p>
          </FlowBody>
          <FlowFoot lead={<Button variant="quiet" disabled={going} onClick={cancel}>Not now</Button>}>
            <Button variant="primary" loading={going} onClick={continueToGoogle}>{going ? 'Opening Google' : 'Continue to Google'}</Button>
          </FlowFoot>
        </FlowView>
      </Modal>
    </main>
  );
}
