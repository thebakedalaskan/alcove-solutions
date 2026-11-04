import { clock, errorMessage, type TranscriptLine } from '@alcove/api';
import { Icon, Popover, Spinner, buttonClass, cn, useRaisedToasts, useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { troubles } from '~/features/call/access';
import { RoomLines } from '~/features/call/LiveLines';
import { useLevels } from '~/features/call/Video';
import { LocalMedia } from '~/features/call/media';
import { StageRecording, type StageState } from '~/features/record/stage';
import { UNNAMED, type Waiting } from '~/features/record/uploads';
import { recordOfflineHere } from '~/lib/device';
import { ownerOf, requireAccount } from '~/lib/guards';
import { log } from '~/lib/log';
import { sessions, useLeaveGuard, useLive } from '~/lib/live';
import { q } from '~/lib/queries';
import { hm, shortDay } from '~/lib/time';

/*
 * The stage recorder: one microphone on the table, no call. Record (/record) names the recording and opens this
 * screen, handing the name over in memory (sessions.roomTitle), never in the address; recording starts at once. It
 * records with or without a connection (features/record/stage.ts): offline, it's saved on this device and uploads
 * when the connection is back.
 */
export const Route = createFileRoute('/record/live')({
  beforeLoad: ({ context, preload }) => requireAccount(context.queryClient, preload),
  // Whether this account records without a connection is read first, when it can be (lib/device.ts remembers it).
  loader: async ({ context }) => { if (navigator.onLine) await context.queryClient.ensureQueryData(q.prefs()).catch(() => undefined); },
  component: RecordLive
});

const rlog = log.child({ component: 'room' });
/** Said when finishing leaves the recording on this device to upload. */
const SAVED = 'Saved on this device. It uploads when you’re back online.';

/** What finishing says when the recording stays on this device for now, by what it waits for. */
function keptSaying(waiting: Waiting): string {
  if (waiting === 'signed-out') return 'Saved on this device. It uploads once you sign in again.';
  if (waiting === 'other') return 'Saved on this device. It uploads once the account that recorded it signs in here again.';
  return navigator.onLine ? 'Saved on this device. It keeps trying to upload, and its notes follow.' : SAVED;
}

/** Why what's recorded isn't reaching Alcove right now, and what happens to it (the recording is kept here meanwhile). */
function awayWhy(s: StageState): { pill: string; saved: string; transcript: string } {
  if (s.account === 'other') {
    return { pill: 'Another account', saved: 'Someone else is signed in on this device now. It stays here until its own account signs in again.', transcript: 'What’s said now is transcribed once it uploads.' };
  }
  if (s.account === 'signed-out') return { pill: 'Signed out', saved: 'You’re signed out. It uploads once you sign in again.', transcript: 'What’s said now is transcribed once it uploads.' };
  if (s.online) return { pill: 'Can’t reach Alcove', saved: 'Alcove isn’t answering right now. It’s sent when it does.', transcript: 'Alcove isn’t answering: what’s said now is transcribed once it does.' };
  return { pill: 'Offline', saved: 'It uploads when you’re back online.', transcript: 'Offline: what’s said now is transcribed once you’re back online.' };
}

function RecordLive() {
  const { account } = Route.useRouteContext();
  const [media] = useState(() => new LocalMedia());
  useEffect(() => {
    void media.start({ mic: true, cam: false });
    return () => media.stop();
  }, [media]);
  const { rec, failed } = useStageRecording(ownerOf(account));
  if (failed) {
    return (
      <div className="stage ac-stage"><div className="stg room-stg">
        <Top />
        <div className="room-wait"><div className="wait-in"><Icon name="x" size={22} /><b>Couldn’t start recording</b><p>{failed}</p><Link to="/home" className={buttonClass()}>Go home</Link></div></div>
      </div></div>
    );
  }
  if (!rec) return <div className="stage ac-stage"><div className="stg room-stg"><Top /><div className="room-wait"><Spinner /></div></div></div>;
  return <Recorder rec={rec} media={media} />;
}

/**
 * The recording this screen records into: the one already going in this tab (the screen came back to it), or a new
 * one, started once under the name Record handed over, which is used up then. Kept on this device as it goes unless
 * this account turned "Record without a connection" off.
 */
function useStageRecording(owner: string): { rec: StageRecording | null; failed: string | null } {
  const [rec, setRec] = useState<StageRecording | null>(sessions.recording);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (sessions.recording) return;
    let cancelled = false;
    const keep = recordOfflineHere();
    StageRecording.begin({ title: sessions.roomTitle ?? UNNAMED, owner, keep }).then((r) => {
      if (cancelled) { void r.discard(); return; }
      sessions.roomTitle = null;
      sessions.recording = r;
      setRec(r);
    }, (e: unknown) => {
      rlog.warn('the recording couldn’t start', { keep, online: navigator.onLine, err: e });
      setFailed(!keep && !navigator.onLine ? 'You’re offline, and recording without a connection is off in Settings.' : errorMessage(e));
    });
    return () => { cancelled = true; };
  }, [owner]);
  return { rec, failed };
}

function Top({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const now = new Date();
  return (
    <header className="stg-top">
      {left ?? <Link to="/home" className="stg-back"><Icon name="left" size={17} />Home</Link>}
      <div className="stg-mid"><span className="rm-title"><Icon name="room" size={16} />In the room · {shortDay(now)}, {hm(now)}</span></div>
      <div className="stg-right">{right}</div>
    </header>
  );
}

const wave = (l: number, i: number) => Math.max(6, Math.min(100, 10 + Math.abs(Math.sin(i * 0.5 + Date.now() / 400)) * 50 * (0.4 + l * 1.4)));

/** What's said under the waveform: why it paused by itself, a microphone that isn't working, that it's saving here, or the reminder. */
function Note({ s, media, trouble }: { s: StageState; media: LocalMedia; trouble: ReturnType<typeof troubles>[number] | undefined }) {
  if (s.held === 'forgotten') return <p className="rm-note bad">You signed out on this device, so this recording can’t be kept. Nothing more is recorded.</p>;
  if (trouble) return <p className="rm-note bad">{trouble.title} {trouble.how}{trouble.retry && <> <button type="button" className="rm-retry" onClick={() => void media.retry()}>Try again</button></>}</p>;
  if (s.held === 'offline') return <p className="rm-note bad">Paused: you’re offline, and recording without a connection is off in Settings. Resume once you’re back online.</p>;
  if (s.held === 'full') return <p className="rm-note bad">Paused: there’s no space left on this device to save the recording. Free some up, or get back online, then resume.</p>;
  if (s.keeping && !s.connected) {
    return <div className="rm-saved"><span className="rm-saved-ic"><Icon name="hardDrive" size={17} /></span><span>Saved on this device. {awayWhy(s).saved}<small>Encrypted as it records</small></span></div>;
  }
  return <p className="rm-note">Let everyone here know before you start talking.</p>;
}

function Recorder({ rec, media }: { rec: StageRecording; media: LocalMedia }) {
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
  /** Pausing, by request or by itself (see StageState.held): it looks paused at once, while what was heard goes. */
  const pausing = holding || (s.held !== null && s.status === 'recording');
  const paused = s.status === 'paused' || pausing;
  /** What's recorded isn't reaching Alcove now, so it's saved here for now. */
  const saving = s.keeping && !s.connected;
  const away = awayWhy(s);
  const still = paused || s.ending || s.held === 'forgotten';
  const bars = useLevels(media, 48, !still && m.mic && !!m.camera, wave);
  /* A microphone that isn't working: what's wrong and how to fix it, in place of the reminder. */
  const micTrouble = troubles(m, ['mic'])[0];
  useEffect(() => rec.onLost((msg) => toast(msg, { icon: 'x' })), [rec, toast]);
  const mic = media.micTrack();
  useEffect(() => { if (mic) rec.follow(mic); }, [rec, s.status, mic]);
  useEffect(() => () => rec.close(), [rec]);

  /* Pausing keeps everything said until then: the last audio and speech are sent, or saved here, before it pauses. */
  const pause = async () => {
    setHolding(true);
    await rec.pause();
    setHolding(false);
  };
  const finish = async () => {
    setBusy(true);
    try {
      const done = await rec.finish();
      sessions.recording = null;
      guard.release();
      void qc.invalidateQueries();
      if (done.kind === 'note') await navigate({ to: '/notes/$noteId', params: { noteId: done.noteId }, replace: true });
      else if (done.kind === 'lost') {
        toast('Recording ended. Nothing was kept: this device was signed out.', { icon: 'x' });
        await navigate({ to: '/welcome', replace: true });
      } else {
        toast(keptSaying(done.waiting), { icon: 'hardDrive' });
        await navigate({ to: '/record', replace: true });
      }
    } catch (e) {
      rlog.error('finishing the recording failed', { err: e });
      toast(errorMessage(e), { icon: 'x' });
      setBusy(false);
    }
  };
  const discard = async () => {
    setLeave(false);
    await rec.discard();
    sessions.recording = null;
    if (!guard.proceed()) await navigate({ to: '/home' });
    toast('Recording discarded. Nothing was kept.', { icon: 'trash' });
  };
  const finishLabel = s.held === 'forgotten' ? 'End recording' : saving ? 'Finish and save' : 'Finish and write notes';

  return (
    <div className="stage ac-stage">
      <div className="stg room-stg">
        <Top left={
          <Popover open={leave} onOpenChange={(o) => { setLeave(o); if (!o) guard.stay(); }} stage label="Leave the room" className="w-[290px]"
            anchor={<button type="button" className="stg-back"><Icon name="left" size={17} />Home</button>}>
            <button type="button" className="ac-pop-item" onClick={() => { setLeave(false); void finish(); }}><Icon name="stop" size={18} /><span><b>{finishLabel}</b><small>{s.held === 'forgotten' ? 'Nothing of it can be kept.' : saving ? 'Saves it here; it uploads by itself.' : 'Keeps what was recorded.'}</small></span></button>
            <button type="button" className="ac-pop-item is-caution" onClick={() => void discard()}><Icon name="trash" size={18} /><span><b>Discard recording</b><small>Nothing is kept.</small></span></button>
          </Popover>
        } right={!s.connected && s.held !== 'forgotten' && <span className="off-pill" role="status"><Icon name="wifiOff" size={14} />{away.pill}</span>} />
        <div className={cn('room', still && 'paused')}>
          <div className="rm-hero">
            <div className="rm-dot" aria-hidden="true"><i /></div>
            <h1>{s.ending ? 'Finishing' : paused || s.held === 'forgotten' ? 'Paused' : 'Taking notes'}</h1>
            <input className="rm-name" value={title} aria-label="Name these notes" spellCheck={false} maxLength={160}
              onChange={(e) => setTitle(e.target.value)} onBlur={() => { const t = title.trim(); if (t && t !== s.title) rec.rename(t); else setTitle(s.title); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            <div className="rm-time ac-mono">{clock(s.elapsed)}</div>
            <div className="rm-wave" aria-hidden="true">{bars.map((h, i) => <i key={i} style={{ height: `${still ? 6 : h}%` }} />)}</div>
            <Note s={s} media={media} trouble={micTrouble} />
            <div className="rm-ctrls">
              <button type="button" className="stage-btn lg" aria-label={paused ? 'Resume' : 'Pause'} disabled={pausing || s.ending || s.held === 'forgotten'} onClick={() => (paused ? rec.resume() : void pause())}><Icon name={paused ? 'dot' : 'pause'} size={paused ? 20 : 24} /></button>
              <button type="button" className="rm-stop" disabled={busy} onClick={() => void finish()}>{busy ? <Spinner /> : <Icon name="stop" size={18} />}{finishLabel}</button>
            </div>
          </div>
          <Heard lines={s.transcript} paused={paused} waiting={saving ? away.transcript : null} problem={s.heard} />
        </div>
      </div>
    </div>
  );
}

/*
 * What's been said so far, under the controls, so the timer and the buttons stay in view. `waiting` says why what's
 * said now isn't transcribed yet (it's saved here meanwhile).
 */
function Heard({ lines, paused, waiting, problem }: { lines: TranscriptLine[]; paused: boolean; waiting: string | null; problem: string | null }) {
  const behind = waiting ?? problem;
  return (
    <section className="rm-live" aria-label="Transcript">
      {lines.length ? <RoomLines lines={lines} />
        : <p className="rm-wait">{paused ? 'Paused. Nothing is heard until you resume.' : waiting ?? 'Listening. What’s said appears here a few seconds later.'}</p>}
      {behind && (lines.length > 0 || paused || !waiting) && <p className="rm-problem"><Icon name="clock" size={14} />{behind}</p>}
    </section>
  );
}
