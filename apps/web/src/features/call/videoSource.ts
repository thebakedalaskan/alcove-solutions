/*
 * Where a video in the call's workspace is read from, for the one player everyone in the call hears (sharedVideo.ts): the
 * workspace's media, which a player reads by range. Media isn't in this build yet, so there's nothing to read a video from,
 * and Play for everyone isn't offered. When it lands, this is
 * `(pass) => (video) => api.workspaces.media.url(video.workspaceId, video.documentId, video.mediaId, { pass })`.
 */
import type { VideoSource } from './sharedVideo';

export const videoSourceFor: ((pass: string) => VideoSource) | null = null;
