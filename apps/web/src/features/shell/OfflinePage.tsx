/*
 * What a screen shows when it can't load. Without a connection: that it's offline and that recording still works,
 * with the way to Record. Anything else: that the page didn't load, with Try again.
 */
import { AlcoveApiError, errorCode } from '@alcove/api';
import { Button, EmptyState, Icon, buttonClass } from '@alcove/ui';
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { recordOfflineHere, signedInHere } from '~/features/account/device';

/** Offline: what still works is said, and offered, only to someone signed in on this device who records offline. */
export function OfflinePage() {
  const here = signedInHere() !== null;
  const records = here && recordOfflineHere();
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <EmptyState title="You’re offline"
        action={records ? <Link to="/record" className={buttonClass()}><Icon name="recordDot" size={18} />Record</Link> : undefined}>
        {records
          ? 'This page needs a connection. Recording still works: it saves on this device and uploads when you’re back online.'
          : here
            ? 'This page needs a connection. Recording without a connection is off in Settings, so recording waits for it too.'
            : 'This page needs a connection. It opens once you’re back online.'}
      </EmptyState>
    </div>
  );
}

/** Every screen's error page: offline, or anything else, said plainly. */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  if (errorCode(error) === 'network') return <OfflinePage />;
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <EmptyState title="This page didn’t load"
        action={<Button variant="secondary" icon="retry" onClick={() => void router.invalidate()}>Try again</Button>}>
        {error instanceof AlcoveApiError ? error.message : 'Something went wrong on our side.'}
      </EmptyState>
    </div>
  );
}
