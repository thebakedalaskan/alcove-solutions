/*
 * Test participants for LiveKit rooms (@livekit/rtc-node). Tests join with the tickets the API issues,
 * exactly as a browser would, and observe media, data and room metadata from the other side.
 */
import { dispose } from '@livekit/rtc-node';

/** Releases the native LiveKit runtime. Call once, after every room has disconnected. */
export async function disposeLiveKit(): Promise<void> {
  await dispose();
}
