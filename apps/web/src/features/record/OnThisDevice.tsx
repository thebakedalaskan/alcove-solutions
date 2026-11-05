/*
 * Record's "On this device": the recordings kept here that haven't uploaded yet (uploads.ts), and how each stands:
 * recording now, waiting for a connection, uploading, refused by Alcove for now (with why), or for good: too old to
 * upload, or unreadable on this device. Each can be uploaded now (when it can be), or deleted from this device, which
 * asks first, in the same menu. Shown only while there are some.
 */
import { MAX_RECORDING_AGE_DAYS } from '@alcove/api';
import { Icon, IconButton, Popover, cn, useToast, type IconName } from '@alcove/ui';
import { useId, useState } from 'react';
import { log } from '~/lib/log';
import { useLive, useOnline } from '~/lib/live';
import { hm, hoursAndMinutes, noteDay } from '~/lib/time';
import { UNNAMED, uploads, type KeptItem } from './uploads';

const klog = log.child({ component: 'record' });

export function OnThisDevice() {
  const v = useLive(uploads);
  const online = useOnline();
  const h = useId();
  if (!v.list.length) return null;
  const waiting = v.list.filter((k) => k.status !== 'recording' && k.status !== 'expired' && k.status !== 'unreadable').length;
  return (
    <section className="rec-list" aria-labelledby={h}>
      <div className="rec-h"><h2 id={h}>On this device{waiting > 0 && <span className="n">{waiting}</span>}</h2></div>
      <ul className="rec-rows">{v.list.map((k) => <Row key={k.id} k={k} online={online} />)}</ul>
    </section>
  );
}

/** How a kept recording stands, in a few words, with its mark, its colour and anything more to say about it. */
function standing(k: KeptItem, online: boolean): { text: string; icon: IconName; tone?: 'is-rec' | 'is-up' | 'is-warn' | undefined; more?: string | undefined } {
  switch (k.status) {
    case 'recording': return { text: 'Recording now', icon: 'recordDot', tone: 'is-rec' };
    case 'uploading': return { text: 'Uploading', icon: 'upload', tone: 'is-up' };
    case 'refused': return { text: 'Can’t upload yet', icon: 'alert', tone: 'is-warn', more: k.problem ?? undefined };
    case 'expired': return { text: 'Can’t upload', icon: 'alert', tone: 'is-warn', more: `More than ${MAX_RECORDING_AGE_DAYS} days old, so it can only be deleted.` };
    case 'unreadable': return { text: 'Can’t be read here', icon: 'alert', tone: 'is-warn', more: 'This device can’t open it any more, so it can only be deleted.' };
    case 'waiting': return online ? { text: 'Waiting to upload', icon: 'clock' } : { text: 'Waiting for a connection', icon: 'cloudOff' };
  }
}

function Row({ k, online }: { k: KeptItem; online: boolean }) {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const toast = useToast();
  const { text, icon, tone, more } = standing(k, online);
  const name = k.title || UNNAMED;
  const long = k.seconds < 60 ? 'Under a minute' : hoursAndMinutes(k.seconds / 60);
  const day = noteDay(k.startedAt);
  const busy = k.status === 'recording' || k.status === 'uploading';
  const canUpload = online && (k.status === 'waiting' || k.status === 'refused');
  const remove = () => {
    setOpen(false);
    setSure(false);
    uploads.discard(k.id).then((gone) => {
      if (gone) toast('Deleted from this device.', { icon: 'trash' });
      else toast('Another tab is using it, so it wasn’t deleted. Try again in a moment.', { icon: 'x' });
    }, (e: unknown) => {
      klog.error('couldn’t delete a recording from this device', { id: k.id, err: e });
      toast('It couldn’t be deleted from this device. Try again.', { icon: 'x' });
    });
  };
  return (
    <li className={cn('rec-r', tone)}>
      <span className="rec-i"><Icon name={icon} size={17} /></span>
      <span className="rec-t">
        <b className="ac-clamp-1">{name}</b>
        <small className="ac-clamp-1">{long} · {day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : `on ${day}`} at {hm(k.startedAt)}</small>
      </span>
      <span className="rec-s">
        <span className="ac-clamp-1">{text}</span>
        {k.status === 'uploading' && <span className="rec-going" aria-hidden="true"><i /></span>}
      </span>
      {/* The column stays while one is busy, so every row's menu lines up. */}
      <span className="rec-more">
        {!busy && (
          <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSure(false); }} side="top" align="end" stage label={`${name}: more`} tip="More" className="rec-pop"
            anchor={<IconButton icon="more" size={17} label={`More for ${name}`} title={undefined} className="rec-dots" />}>
            {sure ? (
              <>
                <p className="ac-pop-h">Delete “{name}”?</p>
                <button type="button" className="ac-pop-item is-caution" onClick={remove}>
                  <Icon name="trash" size={17} /><span><b>Delete it</b><small>It never uploads, and nothing of it is kept.</small></span>
                </button>
                <button type="button" className="ac-pop-item" onClick={() => setSure(false)}>
                  <Icon name="left" size={17} /><span><b>Keep it</b></span>
                </button>
              </>
            ) : (
              <>
                {canUpload && (
                  <button type="button" className="ac-pop-item" onClick={() => { setOpen(false); uploads.kick(); }}>
                    <Icon name="upload" size={17} /><span><b>Upload now</b><small>Then its notes are written.</small></span>
                  </button>
                )}
                <button type="button" className="ac-pop-item is-caution" onClick={() => setSure(true)}>
                  <Icon name="trash" size={17} /><span><b>Delete from this device</b></span>
                </button>
              </>
            )}
          </Popover>
        )}
      </span>
      {more && <span className="rec-why">{more}</span>}
    </li>
  );
}
