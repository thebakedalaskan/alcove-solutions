import { type HttpTransport } from './http';
import { AUDIO_HEADERS, type AudioPiece, type TranscriptClip } from '@alcove/api';

export function createAudioTransport(t: HttpTransport) {
  const { send } = t;

  /** Where a piece or clip starts in its segment, in the milliseconds the headers carry. */
  const atMs = (at: number) => String(Math.round(at * 1000));

  const audio = (path: string, piece: AudioPiece, extra: Record<string, string> = {}) => send('POST', path, piece.data, {
    ...extra, 'content-type': piece.mimeType, [AUDIO_HEADERS.segment]: String(piece.segment), [AUDIO_HEADERS.seq]: String(piece.seq),
    [AUDIO_HEADERS.at]: atMs(piece.at), [AUDIO_HEADERS.duration]: String(Math.round(piece.durationMs))
  }).then((r) => r.json());

  /** Speech for the live transcript: WAV bytes, placed by where the clip starts in its segment. */
  const clip = (path: string, c: TranscriptClip, extra: Record<string, string> = {}) => send('POST', path, c.data, {
    ...extra, 'content-type': 'audio/wav', [AUDIO_HEADERS.segment]: String(c.segment), [AUDIO_HEADERS.at]: atMs(c.at), [AUDIO_HEADERS.duration]: String(Math.round(c.durationMs))
  }).then((r) => r.json());
  return { audio, clip };
}
