/*
 * Video quality in a call, each person's own: the most camera video they send (360p to save data, 720p, or 1080p
 * where their camera has it), and how they see everyone else's cameras (as sharp as each tile needs, at their
 * smallest, or none). Remembered in this browser. Shared screens aren't changed by either.
 */
import type { VideoReceive, VideoSend } from '@alcove/api';
import { Segmented, type Choice } from '@alcove/ui';
import { cameraSends, type LocalMedia, type MediaSnapshot } from './media';

const SEND: Choice<VideoSend>[] = [{ value: 'saver', label: '360p' }, { value: 'standard', label: '720p' }, { value: 'hd', label: 'HD 1080p' }];
const SEND_SAYS: Record<VideoSend, string> = {
  saver: 'Your camera at 360p, for a slow or metered connection.',
  standard: 'Your camera at up to 720p.',
  hd: 'Your camera at up to 1080p, where it can. Uses more upload and battery.'
};
const SEE: Choice<VideoReceive>[] = [{ value: 'auto', label: 'Auto' }, { value: 'saver', label: 'Data saver' }, { value: 'off', label: 'No cameras' }];
const SEE_SAYS: Record<VideoReceive, string> = {
  auto: 'Each camera as sharp as its tile on your screen.',
  saver: 'Cameras at their smallest. Shared screens stay sharp.',
  off: 'Nobody’s camera. You still see shared screens and hear everyone.'
};

export function VideoQuality({ media, m }: { media: LocalMedia; m: MediaSnapshot }) {
  // HD where the camera has it: one that tops out lower says so, and that's what's sent.
  const { most } = cameraSends(m.sendVideo, m.cam ? media.camSource() : null);
  const sends = most !== null ? `Your camera gives ${most}p at most, so that’s what’s sent.` : SEND_SAYS[m.sendVideo];
  return (
    <div className="ic-vq">
      <div className="ac-eyebrow">Video you send</div>
      <Segmented label="Video you send" value={m.sendVideo} onChange={(v) => void media.setSendVideo(v)} options={SEND} />
      <p className="ic-vq-says" aria-live="polite">{sends}</p>
      <div className="ac-eyebrow mt">Video you see</div>
      <Segmented label="Video you see" value={m.receiveVideo} onChange={(v) => media.setReceiveVideo(v)} options={SEE} />
      <p className="ic-vq-says" aria-live="polite">{SEE_SAYS[m.receiveVideo]}</p>
    </div>
  );
}
