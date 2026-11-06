import { createAudioTransport } from '../transport/audio';
import { type HttpTransport } from '../transport/http';
import { HttpRecording } from './session';
import { type AlcoveApi, RecordingStopResultSchema, RoomRecordingStateSchema } from '@alcove/api';
import { z } from 'zod';

export function createRecordingsApi(t: HttpTransport): Pick<AlcoveApi, 'recordings'> {
  const { parse, req } = t;
  const { audio, clip } = createAudioTransport(t);
  return {
    recordings: {
      start: async (input) => new HttpRecording(await req(RoomRecordingStateSchema, 'POST', '/recordings', input ?? {}), {
        act: (id, a) => req(RoomRecordingStateSchema, 'POST', `/recordings/${id}/actions`, a),
        audio: async (id, p) => parse(RoomRecordingStateSchema, await audio(`/recordings/${id}/audio`, p), 'recording state'),
        transcribe: async (id, c) => parse(RoomRecordingStateSchema, await clip(`/recordings/${id}/transcribe`, c), 'recording state'),
        stop: (id) => req(RecordingStopResultSchema, 'POST', `/recordings/${id}/stop`, {}),
        discard: async (id) => { await req(z.unknown(), 'DELETE', `/recordings/${id}`); }
      })
    }
  };
}
