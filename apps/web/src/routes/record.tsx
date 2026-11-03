import { clock, errorMessage, type RoomRecording, type TranscriptLine } from '@alcove/api';
import { Icon, Popover, Spinner, cn, useRaisedToasts, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RoomLines } from '~/features/call/LiveLines';
import { useLevels } from '~/features/call/Video';
import { LocalMedia, NotesRecorder } from '~/features/call/media';
import { SpeechClips } from '~/features/call/speech';
import { api } from '~/lib/api';
import { requireAccount } from '~/lib/guards';
import { log } from '~/lib/log';
import { sessions, useLeaveGuard, useLive } from '~/lib/live';
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
        <div className="room-wait"><div className="wait-in"><Icon name="x" size={22} /><b>Couldn’t start recording</b><p>{failed}</p><Link to="/home" className="btn btn-secondary">Go home</Link></div></div>
      </div></div>
    );
  }
  if (!rec) return <div className="stage"><div className="stg room-stg"><Top /><div className="room-wait"><Spinner /></div></div></div>;
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
  /** Pausing waits for the last audio and speech to be sent; the room looks paused straight away. */
  const [holding, setHolding] = useState(false);
  const [leave, setLeave] = useState(false);
  /* Back, or anywhere else, asks to finish or discard first: the recorder can't pick up where it left off. */
  const guard = useLeaveGuard(() => setLeave(true));
  const [title, setTitle] = useState(s.title);
  const [heardProblem, setHeardProblem] = useState<string | null>(null);
  const paused = s.status === 'paused' || holding;
  const bars = useLevels(media, 48, !paused && m.mic && !!m.camera, wave);
  const recorder = useRef<NotesRecorder | null>(null);
  if (!recorder.current) recorder.current = new NotesRecorder((p) => rec.appendAudio(p), (msg) => toast(msg, { icon: 'x' }));
  const speech = useRef<SpeechClips | null>(null);
  if (!speech.current) speech.current = new SpeechClips((c) => rec.transcribe(c), setHeardProblem);
  const mic = media.micTrack();
  useEffect(() => {
    const r = recorder.current;
    const sp = speech.current;
    if (!r || !sp || !mic) return;
    if (s.status === 'recording') { r.start(mic, 0); sp.start(mic, 0); }
    if (s.status === 'paused') { void r.pause(); sp.pause(); }
  }, [s.status, mic]);
  useEffect(() => () => speech.current?.stop(), []);

  /* Pausing keeps everything said until then: the last audio and speech are sent before the recording pauses. */
  const pause = async () => {
    setHolding(true);
    speech.current?.pause();
    await Promise.all([recorder.current?.pause(), speech.current?.flush()]);
    rec.pause();
    setHolding(false);
  };
  const finish = async () => {
    setBusy(true);
    try {
      await Promise.all([recorder.current?.flush(), speech.current?.flush()]);
      speech.current?.stop();
      const r = await rec.stop();
      sessions.recording = null;
      guard.release();
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
    speech.current?.stop();
    try { await rec.discard(); } catch (e) { rlog.warn('discarding the recording failed', { err: e }); }
    sessions.recording = null;
    if (!guard.proceed()) await navigate({ to: '/home' });
    toast('Recording discarded. Nothing was kept.', { icon: 'trash' });
  };

  return (
    <div className="stage">
      <div className="stg room-stg">
        <Top right={
          <Popover open={leave} onOpenChange={(o) => { setLeave(o); if (!o) guard.stay(); }} dark label="Leave the room" className="w-[290px]"
            anchor={<button type="button" className="stg-back"><Icon name="left" size={17} />Home</button>}>
            <button type="button" className="pop-item" onClick={() => { setLeave(false); void finish(); }}><Icon name="stop" size={18} /><span><b>Finish and write notes</b><small>Keeps what was recorded.</small></span></button>
            <button type="button" className="pop-item danger" onClick={() => void discard()}><Icon name="trash" size={18} /><span><b>Discard recording</b><small>Nothing is kept.</small></span></button>
          </Popover>
        } />
        <div className={cn('room', paused && 'paused')}>
          <div className="rm-hero">
            <div className="rm-dot" aria-hidden="true"><i /></div>
            <h1>{paused ? 'Paused' : 'Taking notes'}</h1>
            <input className="rm-name" value={title} aria-label="Name these notes" spellCheck={false}
              onChange={(e) => setTitle(e.target.value)} onBlur={() => { const t = title.trim(); if (t && t !== s.title) rec.rename(t); else setTitle(s.title); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            <div className="rm-time mono">{clock(s.elapsed)}</div>
            <div className="rm-wave" aria-hidden="true">{bars.map((h, i) => <i key={i} style={{ height: `${paused ? 6 : h}%` }} />)}</div>
            {m.error ? <p className="rm-note text-[#FFB3B5]">{m.error}</p> : <p className="rm-note">Let everyone here know before you start talking.</p>}
            <div className="rm-ctrls">
              <button type="button" className="rb lg" aria-label={paused ? 'Resume' : 'Pause'} disabled={holding} onClick={() => (paused ? rec.resume() : void pause())}><Icon name={paused ? 'dot' : 'pause'} size={paused ? 20 : 24} /></button>
              <button type="button" className="rm-stop" disabled={busy} onClick={() => void finish()}>{busy ? <Spinner /> : <Icon name="stop" size={18} />}Finish and write notes</button>
            </div>
          </div>
          <Heard lines={s.transcript} paused={paused} problem={heardProblem} />
        </div>
      </div>
    </div>
  );
}

/* What's been said so far, under the controls, so the timer and the buttons stay in view. */
function Heard({ lines, paused, problem }: { lines: TranscriptLine[]; paused: boolean; problem: string | null }) {
  return (
    <section className="rm-live" aria-label="Transcript">
      {lines.length ? <RoomLines lines={lines} />
        : <p className="rm-wait">{paused ? 'Paused. Nothing is heard until you resume.' : 'Listening. What’s said appears here a few seconds later.'}</p>}
      {problem && <p className="rm-problem"><Icon name="clock" size={14} />{problem}</p>}
    </section>
  );
}
