import { clock, errorMessage, type RoomRecording } from '@alcove/api';
import { Icon, Popover, Spinner, cn, useRaisedToasts, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLevels } from '~/features/call/Video';
import { LocalMedia, NotesRecorder } from '~/features/call/media';
import { api } from '~/lib/api';
import { requireAccount } from '~/lib/guards';
import { log } from '~/lib/log';
import { sessions, useLive } from '~/lib/live';
import { hm, shortDay } from '~/lib/time';

/* Notes in the room: one microphone on the table, no call. */
export const Route = createFileRoute('/record')({
  beforeLoad: ({ context }) => requireAccount(context.queryClient),
  component: Record
});

const rlog = log.child({ component: 'room' });

function Record() {
  const [media] = useState(() => new LocalMedia());
  const [rec, setRec] = useState<RoomRecording | null>(sessions.recording);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    void media.start({ mic: true, cam: false });
    if (sessions.recording) return () => media.stop();
    let cancelled = false;
    api.recordings.start('Notes from the room').then((r) => {
      if (cancelled) { void r.discard(); return; }
      sessions.recording = r;
      setRec(r);
    }, (e: unknown) => setFailed(errorMessage(e)));
    return () => { cancelled = true; media.stop(); };
  }, [media]);
  if (failed) {
    return (
      <div className="stage"><div className="stg room-stg">
        <Top />
        <div className="room"><div className="wait-in"><Icon name="x" size={22} /><b>Couldn’t start recording</b><p>{failed}</p><Link to="/home" className="btn btn-secondary">Go home</Link></div></div>
      </div></div>
    );
  }
  if (!rec) return <div className="stage"><div className="stg room-stg"><Top /><div className="room"><Spinner /></div></div></div>;
  return <Recorder rec={rec} media={media} />;
}

function Top({ right }: { right?: ReactNode }) {
  const now = new Date();
  return (
    <header className="stg-top">
      {right ?? <Link to="/home" className="stg-back"><Icon name="left" size={17} />Home</Link>}
      <div className="stg-mid"><span className="rm-title"><Icon name="room" size={16} />In the room · {shortDay(now)}, {hm(now)}</span></div>
      <div className="stg-right" />
    </header>
  );
}

const wave = (l: number, i: number) => Math.max(6, Math.min(100, 10 + Math.abs(Math.sin(i * 0.5 + Date.now() / 400)) * 50 * (0.4 + l * 1.4)));

function Recorder({ rec, media }: { rec: RoomRecording; media: LocalMedia }) {
  const s = useLive(rec);
  const m = useLive(media);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  useRaisedToasts();
  const [busy, setBusy] = useState(false);
  const [leave, setLeave] = useState(false);
  const [title, setTitle] = useState(s.title);
  const paused = s.status === 'paused';
  const bars = useLevels(media, 48, !paused && m.mic && !!m.camera, wave);
  const recorder = useRef<NotesRecorder | null>(null);
  if (!recorder.current) recorder.current = new NotesRecorder((p) => rec.appendAudio(p), (msg) => toast(msg, { icon: 'x' }));
  const mic = media.micTrack();
  useEffect(() => {
    const r = recorder.current;
    if (!r || !mic) return;
    if (s.status === 'recording') r.start(mic, 0);
    if (s.status === 'paused') r.pause();
  }, [s.status, mic]);

  const finish = async () => {
    setBusy(true);
    try {
      await recorder.current?.flush();
      const r = await rec.stop();
      sessions.recording = null;
      void qc.invalidateQueries();
      await navigate({ to: '/notes/$noteId', params: { noteId: r.pendingNoteId }, replace: true });
    } catch (e) {
      rlog.error('finishing the recording failed', { err: e });
      toast(errorMessage(e), { icon: 'x' });
      setBusy(false);
    }
  };
  const discard = async () => {
    setLeave(false);
    recorder.current?.stop();
    try { await rec.discard(); } catch (e) { rlog.warn('discarding the recording failed', { err: e }); }
    sessions.recording = null;
    await navigate({ to: '/home' });
    toast('Recording discarded. Nothing was kept.', { icon: 'trash' });
  };

  return (
    <div className="stage">
      <div className="stg room-stg">
        <Top right={
          <Popover open={leave} onOpenChange={setLeave} dark label="Leave the room" className="w-[290px]"
            anchor={<button type="button" className="stg-back"><Icon name="left" size={17} />Home</button>}>
            <button type="button" className="pop-item" onClick={() => { setLeave(false); void finish(); }}><Icon name="stop" size={18} /><span><b>Finish and write notes</b><small>Keeps what was recorded.</small></span></button>
            <button type="button" className="pop-item danger" onClick={() => void discard()}><Icon name="trash" size={18} /><span><b>Discard recording</b><small>Nothing is kept.</small></span></button>
          </Popover>
        } />
        <div className={cn('room', paused && 'paused')}>
          <div className="rm-dot" aria-hidden="true"><i /></div>
          <h1>{paused ? 'Paused' : 'Taking notes'}</h1>
          <input className="rm-name" value={title} aria-label="Name these notes" spellCheck={false}
            onChange={(e) => setTitle(e.target.value)} onBlur={() => { const t = title.trim(); if (t && t !== s.title) rec.rename(t); else setTitle(s.title); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <div className="rm-time mono">{clock(s.elapsed)}</div>
          <div className="rm-wave" aria-hidden="true">{bars.map((h, i) => <i key={i} style={{ height: `${paused ? 6 : h}%` }} />)}</div>
          {m.error ? <p className="rm-note text-[#FFB3B5]">{m.error}</p> : <p className="rm-note">Let everyone here know before you start talking.</p>}
          <div className="rm-ctrls">
            <button type="button" className="rb lg" aria-label={paused ? 'Resume' : 'Pause'} onClick={() => (paused ? rec.resume() : rec.pause())}><Icon name={paused ? 'dot' : 'pause'} size={paused ? 20 : 24} /></button>
            <button type="button" className="rm-stop" disabled={busy} onClick={() => void finish()}>{busy ? <Spinner /> : <Icon name="stop" size={18} />}Finish and write notes</button>
          </div>
        </div>
      </div>
    </div>
  );
}
