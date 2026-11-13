/*
 * The stage recorder: one microphone on the table, no call. Record (/record) names the recording and opens this
 * screen, handing the name over in memory (sessions.roomTitle), never in the address; recording starts at once. It's the
 * same night as Record, over the whole window: the orb fills while it records, your voice runs across the water, and what's
 * said comes up under it. It records with or without a connection (stage.ts): offline, it's saved on this device and uploads
 * when the connection is back. `owner`: the account it records for, signed in or signed in here last.
 */
import { clock, errorMessage } from '@alcove/api';
import { Button, Horizon, Icon, Popover, RecorderSun, Spinner, buttonClass, cn, useRaisedToasts, useToast, useVoice, type IconName } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { troubles, type Trouble } from '~/features/call/media/access';
import { RoomLines } from '~/features/call/notes/LiveLines';
import { LocalMedia } from '~/features/call/media/media';
import { recordOfflineHere } from '~/features/account/device';
import { log } from '~/lib/log';
import { useLeaveGuard, useLive } from '~/lib/live';
import { sessions } from '~/features/call/session/handoff';
import { StageRecording, type StageState } from './stage';
import { UNNAMED, type Waiting } from './uploads';

const rlog = log.child({ component: 'room' });
/** Said when finishing leaves the recording on this device to upload. */
const SAVED = 'Saved on this device. It uploads when you’re back online.';
/** How many recorded seconds the reminder keeps its place, whatever else there is to say about where the recording goes. */
const REMINDER_S = 20;

/** What finishing says when the recording stays on this device for now, by what it waits for. */
function keptSaying(waiting: Waiting): string {
  if (waiting === 'signed-out') return 'Saved on this device. It uploads once you sign in again.';
  if (waiting === 'other') return 'Saved on this device. It uploads once the account that recorded it signs in here again.';
  return navigator.onLine ? 'Saved on this device. It keeps trying to upload, and its notes follow.' : SAVED;
}

/** Why what's recorded isn't reaching Alcove right now, and what happens to it (the recording is kept here meanwhile). */
function awayWhy(s: StageState): { pill: string; saved: string } {
  if (s.account === 'other') return { pill: 'Another account', saved: 'Someone else is signed in here now. It stays until this account signs in again.' };
  if (s.account === 'signed-out') return { pill: 'Signed out', saved: 'You’re signed out. It uploads once you sign in again.' };
  if (s.online) return { pill: 'Can’t reach Alcove', saved: 'Alcove isn’t answering right now. It’s sent when it does.' };
  return { pill: 'Offline', saved: 'It uploads when you’re back online.' };
}

export function LiveRecordPage({ owner }: { owner: string }) {
  const [media] = useState(() => new LocalMedia());
  useEffect(() => {
    void media.start({ mic: true, cam: false });
    return () => media.stop();
  }, [media]);
  const { rec, failed } = useStageRecording(owner);
  return (
    <div className="stage ac-stage rec-stage" role="region" aria-label="Recording">
      <Horizon moment="record" />
      {failed ? <Failed why={failed} /> : rec ? <Recorder rec={rec} media={media} /> : <Starting />}
    </div>
  );
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

const home = cn(buttonClass({ variant: 'quiet', size: 'sm' }), 'rec-back');

function Bar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return <header className="rec-bar">{left ?? <Link to="/home" className={home}><Icon name="left" size={16} />Home</Link>}{right}</header>;
}

/** The moment before it records: the same place, with the orb still to rise. */
function Starting() {
  return (
    <>
      <Bar />
      <div className="rec-hold">
        <p className="rec-name is-live ac-clamp-1">{sessions.roomTitle ?? UNNAMED}</p>
        <p className="rec-time">{clock(0)}</p>
        <div className="rec-ctl"><Spinner /></div>
      </div>
    </>
  );
}

function Failed({ why }: { why: string }) {
  return (
    <>
      <RecorderSun orb="idle" voice="still" />
      <Bar />
      <div className="rec-hold">
        <h1 className="rec-name is-live">Couldn’t start recording</h1>
        <p className="rec-said is-warn">{why}</p>
        <div className="rec-ctl"><Link to="/record" className={buttonClass({ variant: 'primary' })}>Back to Record</Link></div>
      </div>
    </>
  );
}

interface Say { text: string; sub?: string | undefined; icon?: IconName | undefined; warn?: boolean | undefined; retry?: boolean | undefined }

const REMINDER: Say = { text: 'Listening. Let everyone here know it’s recording.' };

/**
 * What's said under the voice, one thing at a time: why it stopped by itself, a finish that failed, a microphone that isn't
 * working, that it's paused, then the reminder for the first moments, even with no connection, and only after them that
 * it's saving here or why the words are behind. Until the first words the reminder stays.
 */
function sayOf(s: StageState, trouble: Trouble | undefined, paused: boolean, finishing: boolean): Say | null {
  if (s.held === 'forgotten') return { text: 'You signed out on this device, so this recording can’t be kept. Nothing more is recorded.', icon: 'alert', warn: true };
  if (s.ending && !finishing) return { text: 'It hasn’t finished, and nothing more is recorded. Try Finish again.', icon: 'alert', warn: true };
  if (trouble) return { text: `${trouble.title}${trouble.how ? ` ${trouble.how}` : ''}`, icon: 'micOff', warn: true, retry: trouble.retry };
  if (!s.keeping && !s.online && !s.ending) return { text: 'Paused: you’re offline, and recording without a connection is off. Resume once you’re back.', icon: 'wifiOff', warn: true };
  if (s.held === 'full') return { text: 'Paused: there’s no space left on this device. Free some up, or get back online, then resume.', icon: 'hardDrive', warn: true };
  if (paused) return { text: 'Paused. Nothing is heard until you resume.' };
  if (!s.ending && s.elapsed < REMINDER_S) return REMINDER;
  if (s.keeping && !s.connected) return { text: `Saved on this device. ${awayWhy(s).saved}`, sub: 'What’s said now is written out then.', icon: 'hardDrive' };
  if (s.heard) return { text: s.heard, icon: 'clock' };
  return s.transcript.length || s.ending ? null : REMINDER;
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
  const forgotten = s.held === 'forgotten';
  const paused = s.status === 'paused' || pausing || forgotten;
  /** What's recorded isn't reaching Alcove now, so it's saved here for now. */
  const saving = s.keeping && !s.connected;
  const still = paused || s.ending;
  /* A microphone that isn't working: what's wrong and how to fix it, in place of the reminder. */
  const micTrouble = troubles(m, ['mic'])[0];
  const sun = useRef<HTMLDivElement>(null);
  useVoice({ sun, level: () => media.level(), on: !still && !micTrouble && m.mic && !!m.camera });
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
      if (done.kind === 'note') await navigate({ to: '/calls/$noteId', params: { noteId: done.noteId }, replace: true });
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
    if (!guard.proceed()) await navigate({ to: '/record', replace: true });
    toast('Recording discarded. Nothing was kept.', { icon: 'trash' });
  };
  const finishLabel = forgotten ? 'End recording' : saving ? 'Finish and save' : 'Finish and write notes';
  const say = sayOf(s, micTrouble, paused, busy);

  return (
    <>
      {/* `ending` stays once finishing has begun, even if it failed; `busy` is whether it's finishing now. */}
      <h1 className="sr-only">{busy ? 'Finishing' : still ? 'Paused' : 'Recording'}</h1>
      <RecorderSun ref={sun} orb={busy ? 'set' : still ? 'paused' : 'live'} voice={still || micTrouble ? 'still' : 'live'} />
      <Bar left={
        <Popover open={leave} onOpenChange={(o) => { setLeave(o); if (!o) guard.stay(); }} stage label="Leave the room" className="rec-pop"
          anchor={<Button variant="quiet" size="sm" icon="left" className="rec-back">Home</Button>}>
          <button type="button" className="ac-pop-item" onClick={() => { setLeave(false); void finish(); }}><Icon name="stop" size={17} className="rec-sq" /><span><b>{finishLabel}</b><small>{forgotten ? 'Nothing of it can be kept.' : saving ? 'Saves it here. It uploads by itself.' : 'Keeps what was recorded.'}</small></span></button>
          <button type="button" className="ac-pop-item is-caution" onClick={() => void discard()}><Icon name="trash" size={17} /><span><b>Discard recording</b><small>Nothing is kept.</small></span></button>
        </Popover>
      } right={!s.connected && !forgotten && <span className="rec-pill" role="status"><Icon name="wifiOff" size={15} />{awayWhy(s).pill}</span>} />
      <div className="rec-hold">
        <input className="rec-name is-live" value={title} placeholder={UNNAMED} aria-label="Name these notes" title="Rename" maxLength={160} autoComplete="off" spellCheck={false}
          onChange={(e) => setTitle(e.target.value)} onBlur={() => { const t = title.trim(); if (t && t !== s.title) rec.rename(t); else setTitle(s.title); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <p className="rec-time" role="timer" aria-label="Time recorded">{clock(s.elapsed)}</p>
        <div className="rec-ctl">
          {/* Resuming while it can't record, with no connection and nowhere to keep it, would lose what's said. */}
          <Button className="rec-pause" icon={paused ? 'recordDot' : 'pause'} disabled={pausing || s.ending || forgotten || (!s.keeping && !s.online)} onClick={() => (paused ? rec.resume() : void pause())}>{paused ? 'Resume' : 'Pause'}</Button>
          <Button variant="primary" className="rec-finish" disabled={busy} onClick={() => void finish()}>{busy ? <Spinner /> : <Icon name="stop" size={16} className="rec-sq" />}{busy ? 'Finishing' : finishLabel}</Button>
        </div>
      </div>
      <section className="rec-heard" aria-label="What’s said">
        {s.transcript.length > 0 && <RoomLines lines={s.transcript} />}
        <div role="status" className="rec-note-at">
          {say && (
            <div className={cn('rec-said', say.warn && 'is-warn')}>
              {say.icon && <Icon name={say.icon} size={17} />}
              <p>{say.text}{say.sub && <small>{say.sub}</small>}{say.retry && <button type="button" className="rec-retry" onClick={() => void media.retry()}>Try again</button>}</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
