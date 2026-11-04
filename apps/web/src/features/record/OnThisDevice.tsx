/*
 * Record's "On this device": the recordings kept here that haven't uploaded yet (uploads.ts), and how each stands:
 * recording now, waiting for a connection, uploading, refused by Alcove for now (with why), or for good: too old to
 * upload, or unreadable on this device. Each can be uploaded now (when it can be), or deleted from this device, which
 * asks first, in the same menu. Shown only while there are some.
 */
import { MAX_RECORDING_AGE_DAYS } from '@alcove/api';
import { Card, Chip, IconButton, Icon, Popover, type ChipTone } from '@alcove/ui';
import { useState } from 'react';
import { useLive, useOnline } from '~/lib/live';
import { hm, hoursAndMinutes, noteDay } from '~/lib/time';
import { UNNAMED, uploads, type KeptItem } from './uploads';

export function OnThisDevice() {
  const v = useLive(uploads);
  const online = useOnline();
  if (!v.list.length) return null;
  const waiting = v.list.filter((k) => k.status !== 'recording' && k.status !== 'expired' && k.status !== 'unreadable').length;
  return (
    <Card title="On this device" aside={waiting > 0 && <Chip tone="outline" icon="cloudOff">{waiting} waiting to upload</Chip>}>
      <p className="rec-dev-lead">Encrypted here until {waiting === 1 ? 'it uploads' : 'they upload'}, then the notes are written. It happens by itself when you’re online.</p>
      <ul className="rec-dev">{v.list.map((k) => <Row key={k.id} k={k} online={online} />)}</ul>
    </Card>
  );
}

/** How a kept recording stands, in a few words, and anything more to say about it. */
function standing(k: KeptItem, online: boolean): { text: string; tone: ChipTone; more?: string | undefined } {
  switch (k.status) {
    case 'recording': return { text: 'Recording now', tone: 'outline' };
    case 'uploading': return { text: 'Uploading', tone: 'horizon' };
    case 'refused': return { text: 'Can’t upload yet', tone: 'caution', more: k.problem ?? undefined };
    case 'expired': return { text: 'Can’t upload', tone: 'caution', more: `Recordings can be uploaded for up to ${MAX_RECORDING_AGE_DAYS} days after they start. This one is older, so it can only be deleted.` };
    case 'unreadable': return { text: 'Can’t be read here', tone: 'caution', more: 'This device can’t open it any more, so it can’t upload. It can only be deleted.' };
    case 'waiting': return { text: online ? 'Waiting to upload' : 'Waiting for a connection', tone: 'outline' };
  }
}

function Row({ k, online }: { k: KeptItem; online: boolean }) {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const { text, tone, more } = standing(k, online);
  const name = k.title || UNNAMED;
  const long = k.seconds < 60 ? 'Under a minute' : hoursAndMinutes(k.seconds / 60);
  const day = noteDay(k.startedAt);
  const busy = k.status === 'recording' || k.status === 'uploading';
  const canUpload = online && (k.status === 'waiting' || k.status === 'refused');
  return (
    <li>
      <span className="ic"><Icon name="hardDrive" size={18} /></span>
      <span className="what">
        <b>{name}</b>
        <small>{long} · recorded {day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day} at {hm(k.startedAt)}</small>
        {more && <small className="why">{more}</small>}
      </span>
      <Chip tone={tone} className="state">{text}</Chip>
      {!busy && (
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSure(false); }} align="end" label={`${name}: more`} className="w-[290px]"
          anchor={<IconButton icon="more" size={17} label="More for this recording" className="more" />}>
          {sure ? (
            <>
              <p className="ac-pop-h">Delete “{name}”?</p>
              <button type="button" className="ac-pop-item is-caution" onClick={() => { setOpen(false); setSure(false); void uploads.discard(k.id); }}>
                <Icon name="trash" size={18} /><span><b>Delete it</b><small>It never uploads, and nothing of it is kept, here or on Alcove.</small></span>
              </button>
              <button type="button" className="ac-pop-item" onClick={() => setSure(false)}>
                <Icon name="left" size={18} /><span><b>Keep it</b><small>It stays on this device.</small></span>
              </button>
            </>
          ) : (
            <>
              {canUpload && (
                <button type="button" className="ac-pop-item" onClick={() => { setOpen(false); uploads.kick(); }}>
                  <Icon name="upload" size={18} /><span><b>Upload now</b><small>Then its notes are written.</small></span>
                </button>
              )}
              <button type="button" className="ac-pop-item is-caution" onClick={() => setSure(true)}>
                <Icon name="trash" size={18} /><span><b>Delete from this device</b><small>Asks first.</small></span>
              </button>
            </>
          )}
        </Popover>
      )}
    </li>
  );
}
