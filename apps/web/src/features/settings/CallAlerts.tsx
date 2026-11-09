/** Call-sized views share Settings' controls without mixing sound switches with browser notification switches. */
import { Icon, Tabs } from '@alcove/ui';
import { useState } from 'react';
import { CallNotificationControls } from './Notifications';
import { CallSoundControls } from './Sounds';
export function CallAlertControls({ speakerId, onBack }: { speakerId: string | null; onBack: () => void }) {
  const [view, setView] = useState<'sounds' | 'browser'>('sounds');
  return <div className="ic-alert-controls">
    <div className="ic-attention-sound-head"><button type="button" onClick={onBack}><Icon name="left" size={15} />More</button><b>Sounds and notifications</b></div>
    <Tabs label="Call alert settings" value={view} onChange={setView} options={[{ value: 'sounds', label: 'Sounds' }, { value: 'browser', label: 'Browser alerts' }]} />
    {view === 'sounds' ? <CallSoundControls speakerId={speakerId} /> : <CallNotificationControls />}
  </div>;
}
