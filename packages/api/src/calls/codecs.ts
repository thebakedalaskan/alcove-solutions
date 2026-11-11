import { z } from '../shared/zod';

/**
 * A browser that can't decode VP9 says so on this topic, sealed like marks, every CALL_CODECS_EVERY_MS while it's in the
 * call (what's said before its media key is in place is lost, so it says it again). A sharer sending VP9
 * (`call.screenShareQuality`) sends VP8 instead while anyone it hears can't decode it: under end to end encryption
 * LiveKit sends no second codec beside the first, so nothing else would tell. Browsers that decode VP9 say nothing.
 */
export const CALL_CODECS_TOPIC = 'codecs/1' as const;

export const CALL_CODECS_EVERY_MS = 10_000;

/** The largest such message a browser reads, and how many a sender can say in a burst and then each second. */
export const CALL_CODECS_LIMITS = { bytes: 128, burst: 3, perSecond: 1 } as const;

export const CallCodecsMessageSchema = z.object({ vp9: z.boolean() });

export type CallCodecsMessage = z.infer<typeof CallCodecsMessageSchema>;
